import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

// --- INLINE VALIDATORS ---
const createShareSchema = z.object({
    resourceType: z.enum(['FILE', 'FOLDER']),
    resourceId: z.string().uuid(),
    granteeEmail: z.string().email('Invalid email address'),
    role: z.enum(['VIEWER', 'EDITOR'])
});

// --- HELPER: Verify Ownership ---
const verifyOwnership = async (userId, resourceType, resourceId) => {
    let resource;
    if (resourceType === 'FILE') {
        resource = await prisma.file.findUnique({ where: { id: resourceId } });
    } else {
        resource = await prisma.folder.findUnique({ where: { id: resourceId } });
    }

    if (!resource || resource.isDeleted || resource.ownerId !== userId) {
        throw new Error('Unauthorized');
    }
    return resource;
};



// POST /shares
export const createShare = async (req, res) => {
    try {
        const validatedData = createShareSchema.parse(req.body);
        const { resourceType, resourceId, granteeEmail, role } = validatedData;
        const ownerId = req.user.id;

        // 1. Verify the requester owns the file/folder
        await verifyOwnership(ownerId, resourceType, resourceId);

        // 2. Find the user to share with
        const granteeUser = await prisma.user.findUnique({ where: { email: granteeEmail } });
        if (!granteeUser) {
            return res.status(404).json({ message: 'User with this email not found' });
        }
        if (granteeUser.id === ownerId) {
            return res.status(400).json({ message: 'Cannot share a resource with yourself' });
        }

        // 3. Create or update the share record
        const share = await prisma.share.upsert({
            where: {
                resourceType_resourceId_granteeUserId: {
                    resourceType,
                    resourceId,
                    granteeUserId: granteeUser.id
                }
            },
            update: { role },
            create: {
                resourceType,
                resourceId,
                granteeUserId: granteeUser.id,
                role,
                createdBy: ownerId
            }
        });

        res.status(201).json({ message: 'Resource shared successfully', share });
    } catch (err) {
        if (err.message === 'Unauthorized') {
            return res.status(403).json({ message: 'Only the owner can share this resource' });
        }
        if (err.name === 'ZodError') {
            return res.status(400).json({ message: 'Validation failed', errors: err.errors });
        }
        res.status(500).json({ message: 'Failed to share resource' });
    }
};

// GET /shares/:resourceType/:resourceId
export const listShares = async (req, res) => {
    try {
        const { resourceType, resourceId } = req.params;
        const ownerId = req.user.id;

        // Ensure valid enum
        if (resourceType !== 'FILE' && resourceType !== 'FOLDER') {
            return res.status(400).json({ message: 'Invalid resource type' });
        }

        await verifyOwnership(ownerId, resourceType, resourceId);

        const shares = await prisma.share.findMany({
            where: { resourceType, resourceId },
            include: {
                granteeUser: { select: { id: true, name: true, email: true, imageUrl: true } }
            }
        });

        res.status(200).json({ shares });
    } catch (err) {
        if (err.message === 'Unauthorized') {
            return res.status(403).json({ message: 'Only the owner can view shares' });
        }
        res.status(500).json({ message: 'Failed to retrieve shares' });
    }
};

// DELETE /shares/:id
export const removeShare = async (req, res) => {
    try {
        const shareId = req.params.id;
        const ownerId = req.user.id;

        const share = await prisma.share.findUnique({ where: { id: shareId } });
        if (!share) {
            return res.status(404).json({ message: 'Share record not found' });
        }

        await verifyOwnership(ownerId, share.resourceType, share.resourceId);

        await prisma.share.delete({ where: { id: shareId } });

        res.status(200).json({ message: 'Access revoked successfully' });
    } catch (err) {
        if (err.message === 'Unauthorized') {
            return res.status(403).json({ message: 'Only the owner can revoke access' });
        }
        res.status(500).json({ message: 'Failed to revoke access' });
    }
};
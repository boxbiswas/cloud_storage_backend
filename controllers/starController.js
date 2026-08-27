import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

// --- INLINE VALIDATORS ---
const starSchema = z.object({
    resourceType: z.enum(['FILE', 'FOLDER']),
    resourceId: z.string().uuid()
});

// --- HELPER: Verify Resource Exists & Is Accessible ---
const verifyResourceAccess = async (userId, resourceType, resourceId) => {
    let resource;
    if (resourceType === 'FILE') {
        resource = await prisma.file.findUnique({ where: { id: resourceId } });
    } else {
        resource = await prisma.folder.findUnique({ where: { id: resourceId } });
    }
    
    if (!resource || resource.isDeleted) {
        throw new Error('Resource not found');
    }

    // Check if owner
    if (resource.ownerId === userId) return true;

    // Check if shared
    const share = await prisma.share.findFirst({
        where: { resourceType, resourceId, granteeUserId: userId }
    });

    if (!share) throw new Error('Unauthorized');
    return true;
};



// POST /stars
export const addStar = async (req, res) => {
    try {
        const validatedData = starSchema.parse(req.body);
        const { resourceType, resourceId } = validatedData;
        const userId = req.user.id;

        await verifyResourceAccess(userId, resourceType, resourceId);

        const star = await prisma.star.upsert({
            where: {
                userId_resourceType_resourceId: {
                    userId,
                    resourceType,
                    resourceId
                }
            },
            update: {}, // Do nothing if it already exists
            create: {
                userId,
                resourceType,
                resourceId
            }
        });

        res.status(201).json({ message: 'Added to starred', star });
    } catch (err) {
        if (err.message === 'Unauthorized' || err.message === 'Resource not found') {
            return res.status(404).json({ message: 'Resource not found or access denied' });
        }
        if (err.name === 'ZodError') {
            return res.status(400).json({ message: 'Validation failed', errors: err.errors });
        }
        res.status(500).json({ message: 'Failed to star resource' });
    }
};

// DELETE /api/stars
// Note: The PDF specifies sending { resourceType, resourceId } to delete.
export const removeStar = async (req, res) => {
    try {
        const validatedData = starSchema.parse(req.body);
        const { resourceType, resourceId } = validatedData;
        const userId = req.user.id;

        await prisma.star.delete({
            where: {
                userId_resourceType_resourceId: {
                    userId,
                    resourceType,
                    resourceId
                }
            }
        });

        res.status(200).json({ message: 'Removed from starred' });
    } catch (err) {
        if (err.code === 'P2025') {
            return res.status(404).json({ message: 'Star record not found' });
        }
        if (err.name === 'ZodError') {
            return res.status(400).json({ message: 'Validation failed', errors: err.errors });
        }
        res.status(500).json({ message: 'Failed to remove star' });
    }
};
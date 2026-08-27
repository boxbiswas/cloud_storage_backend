import { z } from 'zod';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { supabase } from '../config/supabase.js';

const BUCKET_NAME = process.env.SUPABASE_STORAGE_BUCKET || 'drive';

// --- INLINE VALIDATORS ---
const createLinkSchema = z.object({
    resourceType: z.enum(['FILE', 'FOLDER']),
    resourceId: z.string().uuid(),
    password: z.string().optional().nullable(),
    expiresAt: z.string().datetime().optional().nullable()
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



// POST /link-shares
export const createLinkShare = async (req, res) => {
    try {
        const validatedData = createLinkSchema.parse(req.body);
        const { resourceType, resourceId, password, expiresAt } = validatedData;
        const ownerId = req.user.id;

        await verifyOwnership(ownerId, resourceType, resourceId);

        // Generate a secure random token
        const token = crypto.randomBytes(32).toString('hex');

        let passwordHash = null;
        if (password) {
            const saltRounds = 10;
            passwordHash = await bcrypt.hash(password, saltRounds);
        }

        const linkShare = await prisma.linkShare.create({
            data: {
                resourceType,
                resourceId,
                token,
                role: 'VIEWER', // Public links are strictly viewer-only in 2.1 MVP
                passwordHash,
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                createdBy: ownerId
            }
        });

        res.status(201).json({
            message: 'Public link generated',
            link: { id: linkShare.id, token: linkShare.token, expiresAt: linkShare.expiresAt }
        });
    } catch (err) {
        if (err.message === 'Unauthorized') {
            return res.status(403).json({ message: 'Only the owner can create public links' });
        }
        if (err.name === 'ZodError') {
            return res.status(400).json({ message: 'Validation failed', errors: err.errors });
        }
        res.status(500).json({ message: 'Failed to generate public link' });
    }
};

// GET /link/:token
// Note: This is a PUBLIC route. The password (if required) should be passed via headers.
export const resolveLinkShare = async (req, res) => {
    try {
        const { token } = req.params;
        const providedPassword = req.headers['x-link-password'];

        const linkShare = await prisma.linkShare.findUnique({ where: { token } });

        if (!linkShare) {
            return res.status(404).json({ message: 'Link not found or invalid' });
        }

        // Check Expiry
        if (linkShare.expiresAt && new Date() > linkShare.expiresAt) {
            return res.status(410).json({ message: 'This link has expired' });
        }

        // Check Password
        if (linkShare.passwordHash) {
            if (!providedPassword) {
                return res.status(401).json({ message: 'Password required', requirePassword: true });
            }
            const isMatch = await bcrypt.compare(providedPassword, linkShare.passwordHash);
            if (!isMatch) {
                return res.status(401).json({ message: 'Incorrect password' });
            }
        }

        // Resolve Resource
        if (linkShare.resourceType === 'FILE') {
            const file = await prisma.file.findUnique({ where: { id: linkShare.resourceId } });
            if (!file || file.isDeleted) return res.status(404).json({ message: 'File no longer exists' });

            const { data, error } = await supabase.storage
                .from(BUCKET_NAME)
                .createSignedUrl(file.storageKey, 3600);

            if (error) throw new Error('Failed to generate download URL');

            return res.status(200).json({
                resourceType: 'FILE',
                file: { name: file.name, sizeBytes: file.sizeBytes, mimeType: file.mimeType },
                downloadUrl: data.signedUrl
            });
        }

        if (linkShare.resourceType === 'FOLDER') {
            const folder = await prisma.folder.findUnique({ where: { id: linkShare.resourceId } });
            if (!folder || folder.isDeleted) return res.status(404).json({ message: 'Folder no longer exists' });

            const childrenFolders = await prisma.folder.findMany({
                where: { parentId: folder.id, isDeleted: false }
            });
            const files = await prisma.file.findMany({
                where: { folderId: folder.id, isDeleted: false, status: 'READY' }
            });

            return res.status(200).json({
                resourceType: 'FOLDER',
                folder: { name: folder.name },
                contents: { folders: childrenFolders, files }
            });
        }

    } catch (err) {
        console.error("RESOLVE LINK ERROR:", err);
        res.status(500).json({ message: 'Failed to resolve link' });
    }
};

// DELETE /api/link-shares/:id
export const removeLinkShare = async (req, res) => {
    try {
        const linkId = req.params.id;
        const ownerId = req.user.id;

        const linkShare = await prisma.linkShare.findUnique({ where: { id: linkId } });
        if (!linkShare) {
            return res.status(404).json({ message: 'Link share not found' });
        }

        await verifyOwnership(ownerId, linkShare.resourceType, linkShare.resourceId);

        await prisma.linkShare.delete({ where: { id: linkId } });

        res.status(200).json({ message: 'Public link revoked successfully' });
    } catch (err) {
        if (err.message === 'Unauthorized') {
            return res.status(403).json({ message: 'Only the owner can revoke links' });
        }
        res.status(500).json({ message: 'Failed to revoke link' });
    }
};
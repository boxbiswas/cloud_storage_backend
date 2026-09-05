import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

// --- INLINE VALIDATOR ---
const searchQuerySchema = z.object({
    q: z.string().optional(),
    type: z.string().optional(), // 'folder', 'pdf', 'image', etc.
    owner: z.string().optional(), // 'me' or specific UUID
    starred: z.string().transform((val) => val === 'true').optional(),
    shared: z.string().transform((val) => val === 'true').optional(),
    sort: z.enum(['name', 'createdAt', 'updatedAt', 'sizeBytes']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
    limit: z.coerce.number().int().positive().default(20),
    fileCursor: z.string().uuid().optional(),
    folderCursor: z.string().uuid().optional()
});



// GET /search
export const searchResources = async (req, res) => {
    try {
        const queryParams = searchQuerySchema.parse(req.query);
        const userId = req.user.id;
        
        const { q, type, owner, starred, shared, sort, order, limit, fileCursor, folderCursor } = queryParams;

        // Base conditions: exclude deleted items
        const fileWhere = { isDeleted: false, status: 'READY' };
        const folderWhere = { isDeleted: false };

        // 1. Text Search (q) - utilizing PostgreSQL trgm indices via Prisma's `contains` 
        if (q) {
            fileWhere.name = { contains: q, mode: 'insensitive' };
            folderWhere.name = { contains: q, mode: 'insensitive' };
        }

        let sharedFileIds = [];
        let sharedFolderIds = [];

        if (!owner || owner !== 'me') {
            const userShares = await prisma.share.findMany({
                where: { granteeUserId: userId },
                select: { resourceId: true, resourceType: true }
            });
            sharedFileIds = userShares.filter(s => s.resourceType === 'FILE').map(s => s.resourceId);
            sharedFolderIds = userShares.filter(s => s.resourceType === 'FOLDER').map(s => s.resourceId);
        }

        let starredFileIds = [];
        let starredFolderIds = [];

        if (starred) {
            const userStars = await prisma.star.findMany({
                where: { userId: userId },
                select: { resourceId: true, resourceType: true }
            });
            starredFileIds = userStars.filter(s => s.resourceType === 'FILE').map(s => s.resourceId);
            starredFolderIds = userStars.filter(s => s.resourceType === 'FOLDER').map(s => s.resourceId);
        }

        // 2. Owner & Shared Filter
        if (shared) {
            // Only show items where user is grantee, and NOT the owner
            fileWhere.id = { in: sharedFileIds };
            folderWhere.id = { in: sharedFolderIds };
            // Ensure we don't accidentally fetch owned items if they somehow shared with themselves
            fileWhere.ownerId = { not: userId };
            folderWhere.ownerId = { not: userId };
        } else if (owner === 'me') {
            fileWhere.ownerId = userId;
            folderWhere.ownerId = userId;
        } else if (owner) {
            // Search specific owner
            fileWhere.ownerId = owner;
            folderWhere.ownerId = owner;
        } else {
            // Default: show owned AND shared items
            fileWhere.OR = [
                { ownerId: userId },
                { id: { in: sharedFileIds } }
            ];
            folderWhere.OR = [
                { ownerId: userId },
                { id: { in: sharedFolderIds } }
            ];
        }

        // 3. Starred Filter
        let searchFiles = true;
        let searchFolders = true;

        if (starred) {
            if (starredFileIds.length === 0 && starredFolderIds.length === 0) {
                return res.status(200).json({
                    data: { folders: [], files: [] },
                    pagination: { nextFileCursor: null, nextFolderCursor: null, limit }
                });
            }
            if (starredFileIds.length === 0) searchFiles = false;
            if (starredFolderIds.length === 0) searchFolders = false;
            fileWhere.id = { in: starredFileIds };
            folderWhere.id = { in: starredFolderIds };
        }

        // 4. Type Filter

        if (type) {
            if (type.toLowerCase() === 'folder') {
                searchFiles = false;
            } else {
                searchFolders = false;
                // Basic MIME type mapping
                if (type === 'pdf') fileWhere.mimeType = { contains: 'pdf' };
                else if (type === 'image') fileWhere.mimeType = { contains: 'image' };
                else if (type === 'document') fileWhere.mimeType = { contains: 'document' };
            }
        }

        // 5. Execute Queries with Pagination
        let files = [];
        let folders = [];

        // Determine sort object (Folders don't have sizeBytes, default to createdAt)
        const fileOrderBy = { [sort]: order };
        const folderOrderBy = { [sort === 'sizeBytes' ? 'createdAt' : sort]: order };

        if (searchFiles) {
            files = await prisma.file.findMany({
                where: fileWhere,
                take: limit + 1, // Fetch +1 to check for next page
                cursor: fileCursor ? { id: fileCursor } : undefined,
                skip: fileCursor ? 1 : 0,
                orderBy: fileOrderBy,
                include: { owner: { select: { name: true, email: true } } }
            });
        }

        if (searchFolders) {
            folders = await prisma.folder.findMany({
                where: folderWhere,
                take: limit + 1,
                cursor: folderCursor ? { id: folderCursor } : undefined,
                skip: folderCursor ? 1 : 0,
                orderBy: folderOrderBy,
                include: { owner: { select: { name: true, email: true } } }
            });
        }

        // 6. Handle Cursors
        let nextFileCursor = null;
        let nextFolderCursor = null;

        if (files.length > limit) {
            const nextItem = files.pop();
            nextFileCursor = nextItem.id;
        }

        if (folders.length > limit) {
            const nextItem = folders.pop();
            nextFolderCursor = nextItem.id;
        }

        // Attach stars for frontend
        const userStars = await prisma.star.findMany({
            where: { userId },
            select: { resourceId: true, resourceType: true }
        });
        const starredSet = new Set(userStars.map(s => `${s.resourceType}:${s.resourceId}`));
        const foldersWithStars = folders.map(f => ({ ...f, stars: starredSet.has(`FOLDER:${f.id}`) ? [{ id: 'mock' }] : [] }));
        const filesWithStars = files.map(f => ({ ...f, stars: starredSet.has(`FILE:${f.id}`) ? [{ id: 'mock' }] : [] }));

        res.status(200).json({
            data: {
                folders: foldersWithStars,
                files: filesWithStars
            },
            pagination: {
                nextFileCursor,
                nextFolderCursor,
                limit
            }
        });

    } catch (err) {
        console.error("SEARCH ERROR:", err);
        if (err.name === 'ZodError') {
            return res.status(400).json({ message: 'Invalid search parameters', errors: err.errors });
        }
        res.status(500).json({ message: 'Failed to perform search' });
    }
};
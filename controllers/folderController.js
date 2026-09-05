import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { supabase } from '../config/supabase.js';
import { canAccessResource } from '../middlewares/aclMiddleware.js';

// --- INLINE VALIDATORS ---
const createFolderSchema = z.object({
    name: z.string().min(1, 'Folder name is required'),
    parentId: z.string().uuid().optional().nullable()
});

const updateFolderSchema = z.object({
    name: z.string().min(1).optional(),
    parentId: z.string().uuid().optional().nullable()
});

// --- HELPER: Generate Breadcrumbs ---
const generateBreadcrumbs = async (folderId) => {
    const breadcrumbs = [];
    let currentFolder = await prisma.folder.findUnique({ where: { id: folderId } });
    
    while (currentFolder) {
        breadcrumbs.unshift({ id: currentFolder.id, name: currentFolder.name });
        if (currentFolder.parentId) {
            currentFolder = await prisma.folder.findUnique({ where: { id: currentFolder.parentId } });
        } else {
            currentFolder = null;
        }
    }
    return breadcrumbs;
};

// GET /folders/root
// Returns the top-level (parentId = null) folders and files owned by the current user.
export const getRootContents = async (req, res) => {
    try {
        const ownerId = req.user.id;

        console.log('GET ROOT: Fetching folders...');
        // Fetch top-level folders (no parent) that belong to this user and aren't deleted
        const rootFolders = await prisma.folder.findMany({
            where: { ownerId, parentId: null, isDeleted: false },
            include: { owner: { select: { name: true } } },
            orderBy: { name: 'asc' }
        });
        console.log('GET ROOT: Fetched folders');

        console.log('GET ROOT: Fetching files...');
        // Fetch top-level files (no folder) that belong to this user, are ready, and aren't deleted
        const rootFiles = await prisma.file.findMany({
            where: { ownerId, folderId: null, isDeleted: false, status: 'READY' },
            include: { owner: { select: { name: true } } },
            orderBy: { name: 'asc' }
        });
        console.log('GET ROOT: Fetched files');

        console.log('GET ROOT: Fetching stars...');
        // Attach stars for frontend
        const userStars = await prisma.star.findMany({
            where: { userId: ownerId },
            select: { resourceId: true, resourceType: true }
        });
        console.log('GET ROOT: Fetched stars');
        const starredSet = new Set(userStars.map(s => `${s.resourceType}:${s.resourceId}`));
        const rootFoldersWithStars = rootFolders.map(f => ({ ...f, stars: starredSet.has(`FOLDER:${f.id}`) ? [{ id: 'mock' }] : [] }));
        const rootFilesWithStars = rootFiles.map(f => ({ ...f, stars: starredSet.has(`FILE:${f.id}`) ? [{ id: 'mock' }] : [] }));

        console.log('GET ROOT: Sending response...');

        res.status(200).json({
            folder: null,           // No current folder at root
            breadcrumbs: [],        // Empty at root
            children: {
                folders: rootFoldersWithStars,
                files: rootFilesWithStars,
            },
        });
    } catch (err) {
        console.error('GET ROOT ERROR:', err);
        res.status(500).json({ message: 'Failed to load root contents' });
    }
};

export const createFolder = async (req, res) => {
    try {
        const validatedData = createFolderSchema.parse(req.body);
        const { name, parentId } = validatedData;
        const ownerId = req.user.id;

        // Verify parent folder if provided
        if (parentId) {
            const result = await canAccessResource(ownerId, 'FOLDER', parentId, 'EDITOR');
            if (!result.granted) {
                return res.status(403).json({ message: 'Invalid or unauthorized parent folder' });
            }
        }

        const folder = await prisma.folder.create({
            data: {
                name,
                parentId,
                ownerId
            }
        });

        res.status(201).json({ message: 'Folder created', folder });
    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(400).json({ message: 'A folder with this name already exists here' });
        }
        res.status(500).json({ message: 'Failed to create folder' });
    }
};

// GET /folders/:id
export const getFolderContents = async (req, res) => {
    try {
        // req.resource is attached by the requireViewer middleware
        const folderId = req.resource.id; 

        // Get active children (folders and files)
        const childrenFolders = await prisma.folder.findMany({
            where: { parentId: folderId, isDeleted: false },
            include: { owner: { select: { name: true } } },
            orderBy: { name: 'asc' }
        });

        const files = await prisma.file.findMany({
            where: { folderId: folderId, isDeleted: false, status: 'READY' },
            include: { owner: { select: { name: true } } },
            orderBy: { name: 'asc' }
        });

        // Attach stars for frontend
        const userStars = await prisma.star.findMany({
            where: { userId: req.user.id },
            select: { resourceId: true, resourceType: true }
        });
        const starredSet = new Set(userStars.map(s => `${s.resourceType}:${s.resourceId}`));
        const foldersWithStars = childrenFolders.map(f => ({ ...f, stars: starredSet.has(`FOLDER:${f.id}`) ? [{ id: 'mock' }] : [] }));
        const filesWithStars = files.map(f => ({ ...f, stars: starredSet.has(`FILE:${f.id}`) ? [{ id: 'mock' }] : [] }));

        const breadcrumbs = await generateBreadcrumbs(folderId);

        res.status(200).json({
            folder: req.resource,
            breadcrumbs,
            children: {
                folders: foldersWithStars,
                files: filesWithStars
            }
        });
    } catch (err) {
        res.status(500).json({ message: 'Failed to retrieve folder contents' });
    }
};

// PATCH /folders/:id
export const updateFolder = async (req, res) => {
    try {
        const validatedData = updateFolderSchema.parse(req.body);
        const folderId = req.resource.id;

        // Prevent moving a folder into itself
        if (validatedData.parentId === folderId) {
            return res.status(400).json({ message: 'Cannot move a folder into itself' });
        }

        // Check if moving to a new parent folder
        if (validatedData.parentId) {
            // Prevent moving a folder into its own descendant (Cycle detection)
            let queue = [folderId];
            while (queue.length > 0) {
                const currentId = queue.shift();
                if (currentId === validatedData.parentId) {
                    return res.status(400).json({ message: 'Cannot move a folder into its own descendant' });
                }
                const children = await prisma.folder.findMany({ 
                    where: { parentId: currentId, isDeleted: false }, 
                    select: { id: true } 
                });
                queue.push(...children.map(c => c.id));
            }

            const result = await canAccessResource(req.user.id, 'FOLDER', validatedData.parentId, 'EDITOR');
            if (!result.granted) {
                return res.status(403).json({ message: 'Invalid or unauthorized target folder' });
            }
            if (result.resource.ownerId !== req.resource.ownerId) {
                return res.status(403).json({ message: 'Cannot move folder across different owners' });
            }
        }

        const updatedFolder = await prisma.folder.update({
            where: { id: folderId },
            data: validatedData
        });

        res.status(200).json({ message: 'Folder updated', folder: updatedFolder });
    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(400).json({ message: 'A folder with this name already exists here' });
        }
        res.status(500).json({ message: 'Failed to update folder' });
    }
};

// DELETE /folders/:id
export const deleteFolder = async (req, res) => {
    try {
        const folderId = req.resource.id;
        const deletedAt = new Date();

        // Subtree Soft Deletion: Collect all descendant folder IDs using BFS
        const folderIdsToDelete = [folderId];
        let queue = [folderId];

        while (queue.length > 0) {
            const currentId = queue.shift();
            const children = await prisma.folder.findMany({ 
                where: { parentId: currentId, isDeleted: false }, 
                select: { id: true } 
            });
            for (const child of children) {
                folderIdsToDelete.push(child.id);
                queue.push(child.id);
            }
        }

        // Use a transaction to soft-delete the entire subtree (folders and their files)
        await prisma.$transaction([
            prisma.folder.updateMany({
                where: { id: { in: folderIdsToDelete } },
                data: { isDeleted: true, deletedAt }
            }),
            prisma.file.updateMany({
                where: { folderId: { in: folderIdsToDelete }, isDeleted: false },
                data: { isDeleted: true, deletedAt }
            })
        ]);
        
        res.status(200).json({ message: 'Folder and its contents moved to trash' });
    } catch (err) {
        console.error("DELETE FOLDER ERROR:", err);
        res.status(500).json({ message: 'Failed to delete folder' });
    }
};
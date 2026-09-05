import { prisma } from '../lib/prisma.js';
import { supabase } from '../config/supabase.js';

const BUCKET_NAME = process.env.SUPABASE_STORAGE_BUCKET || 'drive';

export const getTrash = async (req, res) => {
    try {
        const ownerId = req.user.id;

        // Fetch all deleted folders
        const allDeletedFolders = await prisma.folder.findMany({
            where: { ownerId, isDeleted: true },
        });
        const deletedFolderIds = new Set(allDeletedFolders.map(f => f.id));

        // Top level trash folders are those whose parent is NOT in the trash
        const topLevelFolders = allDeletedFolders.filter(f => !f.parentId || !deletedFolderIds.has(f.parentId));

        // Fetch all deleted files
        const allDeletedFiles = await prisma.file.findMany({
            where: { ownerId, isDeleted: true },
        });

        // Top level trash files are those whose parent folder is NOT in the trash
        const topLevelFiles = allDeletedFiles.filter(f => !f.folderId || !deletedFolderIds.has(f.folderId));

        res.status(200).json({
            data: {
                folders: topLevelFolders,
                files: topLevelFiles,
            }
        });
    } catch (err) {
        console.error('GET TRASH ERROR:', err);
        res.status(500).json({ message: 'Failed to load trash' });
    }
};

export const restoreItem = async (req, res) => {
    try {
        const { resourceType, resourceId } = req.body;
        const ownerId = req.user.id;

        if (!resourceType || !resourceId) {
            return res.status(400).json({ message: 'Resource type and ID are required' });
        }

        let resource;
        let targetParentId = null;

        if (resourceType === 'FOLDER') {
            resource = await prisma.folder.findUnique({ where: { id: resourceId } });
        } else {
            resource = await prisma.file.findUnique({ where: { id: resourceId } });
        }

        if (!resource || !resource.isDeleted) {
            return res.status(404).json({ message: 'Item not found in trash' });
        }

        // 1. Restore ownership check
        if (resource.ownerId !== ownerId) {
            return res.status(403).json({ message: 'Only the owner can restore this item' });
        }

        // 2. Restore parent validation
        const parentId = resourceType === 'FOLDER' ? resource.parentId : resource.folderId;
        if (parentId) {
            const parent = await prisma.folder.findUnique({ where: { id: parentId } });
            if (parent && !parent.isDeleted) {
                targetParentId = parent.id;
            }
        }

        // 3. Restore name conflict check
        if (resourceType === 'FOLDER') {
            const conflict = await prisma.folder.findFirst({
                where: {
                    ownerId,
                    parentId: targetParentId,
                    name: resource.name,
                    isDeleted: false
                }
            });
            if (conflict) {
                return res.status(409).json({ message: 'A folder with this name already exists at the restore location' });
            }
        } else {
            const conflict = await prisma.file.findFirst({
                where: {
                    ownerId,
                    folderId: targetParentId,
                    name: resource.name,
                    isDeleted: false
                }
            });
            if (conflict) {
                return res.status(409).json({ message: 'A file with this name already exists at the restore location' });
            }
        }

        // Restore
        if (resourceType === 'FOLDER') {
            // Restore folder and all its descendant items in trash
            const folderIdsToRestore = [resource.id];
            let queue = [resource.id];
            while (queue.length > 0) {
                const currentId = queue.shift();
                const children = await prisma.folder.findMany({
                    where: { parentId: currentId, isDeleted: true },
                    select: { id: true }
                });
                for (const child of children) {
                    folderIdsToRestore.push(child.id);
                    queue.push(child.id);
                }
            }

            await prisma.$transaction([
                prisma.folder.updateMany({
                    where: { id: { in: folderIdsToRestore } },
                    data: { isDeleted: false, deletedAt: null }
                }),
                prisma.folder.update({
                    where: { id: resource.id },
                    data: { parentId: targetParentId }
                }),
                prisma.file.updateMany({
                    where: { folderId: { in: folderIdsToRestore }, isDeleted: true },
                    data: { isDeleted: false, deletedAt: null }
                })
            ]);
        } else {
            await prisma.file.update({
                where: { id: resource.id },
                data: {
                    isDeleted: false,
                    deletedAt: null,
                    folderId: targetParentId
                }
            });
        }

        res.status(200).json({ message: 'Item restored successfully' });
    } catch (err) {
        console.error('RESTORE ERROR:', err);
        res.status(500).json({ message: 'Failed to restore item' });
    }
};

const deleteSupabaseFiles = async (storageKeys) => {
    if (storageKeys.length === 0) return;
    
    // Supabase remove takes an array of keys up to 100
    // Split into chunks of 100 if necessary
    const chunkSize = 100;
    for (let i = 0; i < storageKeys.length; i += chunkSize) {
        const chunk = storageKeys.slice(i, i + chunkSize);
        const { error } = await supabase.storage.from(BUCKET_NAME).remove(chunk);
        if (error) {
            console.error('SUPABASE DELETE ERROR:', error);
            throw error;
        }
    }
};

export const permanentDelete = async (req, res) => {
    try {
        const { resourceType, id } = req.params;
        const ownerId = req.user.id;

        let resource;
        if (resourceType === 'FOLDER') {
            resource = await prisma.folder.findUnique({ where: { id } });
        } else {
            resource = await prisma.file.findUnique({ where: { id } });
        }

        if (!resource || !resource.isDeleted) {
            return res.status(404).json({ message: 'Item not found in trash' });
        }

        // 1. Restore ownership check (Permanent Delete ownership check)
        if (resource.ownerId !== ownerId) {
            return res.status(403).json({ message: 'Only the owner can permanently delete this item' });
        }

        if (resourceType === 'FOLDER') {
            // Find all descendant folders and files
            const folderIdsToDelete = [resource.id];
            let queue = [resource.id];
            while (queue.length > 0) {
                const currentId = queue.shift();
                const children = await prisma.folder.findMany({
                    where: { parentId: currentId },
                    select: { id: true }
                });
                for (const child of children) {
                    folderIdsToDelete.push(child.id);
                    queue.push(child.id);
                }
            }

            const filesToDelete = await prisma.file.findMany({
                where: { folderId: { in: folderIdsToDelete } },
                select: { storageKey: true }
            });

            const storageKeys = filesToDelete.map(f => f.storageKey);
            
            // 4. Permanent delete storage first
            await deleteSupabaseFiles(storageKeys);

            await prisma.$transaction([
                prisma.file.deleteMany({
                    where: { folderId: { in: folderIdsToDelete } }
                }),
                // To avoid foreign key constraints (SetNull on parentId), we update parentId to null first
                prisma.folder.updateMany({
                    where: { id: { in: folderIdsToDelete } },
                    data: { parentId: null }
                }),
                prisma.folder.deleteMany({
                    where: { id: { in: folderIdsToDelete } }
                })
            ]);
        } else {
            // 4. Permanent delete storage first
            await deleteSupabaseFiles([resource.storageKey]);
            await prisma.file.delete({ where: { id: resource.id } });
        }

        res.status(200).json({ message: 'Item permanently deleted' });
    } catch (err) {
        console.error('PERMANENT DELETE ERROR:', err);
        res.status(500).json({ message: 'Failed to permanently delete item' });
    }
};

export const emptyTrash = async (req, res) => {
    try {
        const ownerId = req.user.id;

        // Fetch all deleted files for this user
        const filesToDelete = await prisma.file.findMany({
            where: { ownerId, isDeleted: true },
            select: { id: true, storageKey: true }
        });
        
        const storageKeys = filesToDelete.map(f => f.storageKey);
        
        // 4. Permanent delete storage first
        if (storageKeys.length > 0) {
            await deleteSupabaseFiles(storageKeys);
        }

        const deletedFolders = await prisma.folder.findMany({
            where: { ownerId, isDeleted: true },
            select: { id: true }
        });
        const folderIds = deletedFolders.map(f => f.id);

        await prisma.$transaction([
            prisma.file.deleteMany({
                where: { ownerId, isDeleted: true }
            }),
            prisma.folder.updateMany({
                where: { id: { in: folderIds } },
                data: { parentId: null }
            }),
            prisma.folder.deleteMany({
                where: { id: { in: folderIds } }
            })
        ]);

        res.status(200).json({ message: 'Trash emptied' });
    } catch (err) {
        console.error('EMPTY TRASH ERROR:', err);
        res.status(500).json({ message: 'Failed to empty trash' });
    }
};

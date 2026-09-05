import { prisma } from './prisma.js';
import { supabase } from '../config/supabase.js';

const BUCKET_NAME = process.env.SUPABASE_STORAGE_BUCKET || 'drive';

export const purgeExpiredTrash = async () => {
    try {
        console.log('Running daily trash retention purge...');
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        // Find all expired files
        const expiredFiles = await prisma.file.findMany({
            where: { isDeleted: true, deletedAt: { lt: thirtyDaysAgo } },
            select: { id: true, storageKey: true }
        });
        
        if (expiredFiles.length > 0) {
            const storageKeys = expiredFiles.map(f => f.storageKey);
            const chunkSize = 100;
            for (let i = 0; i < storageKeys.length; i += chunkSize) {
                const chunk = storageKeys.slice(i, i + chunkSize);
                const { error } = await supabase.storage.from(BUCKET_NAME).remove(chunk);
                if (error) console.error('SUPABASE DELETE ERROR IN PURGE:', error);
            }
            
            await prisma.file.deleteMany({
                where: { id: { in: expiredFiles.map(f => f.id) } }
            });
            console.log(`Purged ${expiredFiles.length} expired files.`);
        }

        // Find all expired folders
        const expiredFolders = await prisma.folder.findMany({
            where: { isDeleted: true, deletedAt: { lt: thirtyDaysAgo } },
            select: { id: true }
        });

        if (expiredFolders.length > 0) {
            const folderIds = expiredFolders.map(f => f.id);
            await prisma.folder.updateMany({
                where: { id: { in: folderIds } },
                data: { parentId: null }
            });
            await prisma.folder.deleteMany({
                where: { id: { in: folderIds } }
            });
            console.log(`Purged ${expiredFolders.length} expired folders.`);
        }
        
    } catch (err) {
        console.error('Purge error:', err);
    }
};

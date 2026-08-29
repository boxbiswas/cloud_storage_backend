import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { supabase } from '../config/supabase.js';
import { canAccessResource } from '../middlewares/aclMiddleware.js';

// --- INLINE VALIDATORS ---
const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' // xlsx
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB for MVP

const initUploadSchema = z.object({
    name: z.string().min(1, 'File name is required'),
    mimeType: z.string().refine((val) => ALLOWED_MIME_TYPES.includes(val), {
        message: 'File type not allowed'
    }),
    sizeBytes: z.number().int().nonnegative().max(MAX_FILE_SIZE, 'File size exceeds 50MB limit'),
    folderId: z.string().uuid().optional().nullable()
});

const completeUploadSchema = z.object({
    fileId: z.string().uuid(),
    checksum: z.string().optional()
});

// --- INLINE HELPERS ---
const sanitizeFilename = (filename) => {
    // Remove special characters, keep alphanumeric, dashes, underscores, and dots
    const sanitized = filename.replace(/[^a-zA-Z0-9.\-_]/g, '').toLowerCase();
    return sanitized || 'unnamed';
};

const BUCKET_NAME = process.env.SUPABASE_STORAGE_BUCKET || 'drive';



// POST /files/init
export const initUpload = async (req, res) => {
    try {
        const validatedData = initUploadSchema.parse(req.body);
        const { name, mimeType, sizeBytes, folderId } = validatedData;
        let fileOwnerId = req.user.id;

        // If folderId is provided, verify the user has editor access to the folder
        if (folderId) {
            const result = await canAccessResource(req.user.id, 'FOLDER', folderId, 'EDITOR');
            if (!result.granted) {
                return res.status(403).json({ message: 'Invalid or unauthorized folder' });
            }
            fileOwnerId = result.resource.ownerId; // File belongs to the destination folder's owner
        }

        const fileUuid = crypto.randomUUID();
        const slug = sanitizeFilename(name);
        const folderPath = folderId ? folderId : 'root';

        // Storage Key Format: tenants/{owner_id}/folders/{folder_id}/files/{file_uuid}-{slug}.{ext}
        const storageKey = `tenants/${fileOwnerId}/folders/${folderPath}/files/${fileUuid}-${slug}`;

        // Create database record with UPLOADING status
        const newFile = await prisma.file.create({
            data: {
                id: fileUuid,
                name,
                mimeType,
                sizeBytes,
                storageKey,
                ownerId: fileOwnerId,
                folderId,
                status: 'UPLOADING'
            }
        });

        // Generate a signed upload URL from Supabase
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUploadUrl(storageKey);

        if (error) {
            throw new Error(`Supabase upload init failed: ${error.message}`);
        }

        // Do NOT expose the storageKey to the client. Only return the UUID and the signed URL.
        res.status(200).json({
            fileId: newFile.id,
            uploadUrl: data.signedUrl,
            message: 'Upload initialized. Proceed to PUT file to uploadUrl.'
        });

    } catch (err) {
        console.error("INIT UPLOAD ERROR:", err);
        if (err.name === 'ZodError') {
            return res.status(400).json({ message: 'Validation failed', errors: err.errors });
        }
        res.status(500).json({ message: 'Failed to initialize upload' });
    }
};

// POST /files/complete
export const completeUpload = async (req, res) => {
    try {
        const validatedData = completeUploadSchema.parse(req.body);
        const { fileId, checksum } = validatedData;

        // Verify the user has editor access to the file (they uploaded it or have inherited access)
        const result = await canAccessResource(req.user.id, 'FILE', fileId, 'EDITOR');
        
        if (!result.granted) {
            return res.status(404).json({ message: 'File not found or unauthorized' });
        }
        
        const file = result.resource;

        if (file.status !== 'UPLOADING') {
            return res.status(400).json({ message: 'File is not in uploading state' });
        }

        // Verify the file actually exists in Supabase Storage before marking it complete
        const folderPath = file.storageKey.substring(0, file.storageKey.lastIndexOf('/'));
        const fileName = file.storageKey.substring(file.storageKey.lastIndexOf('/') + 1);
        
        const { data: listData, error: listError } = await supabase.storage
            .from(BUCKET_NAME)
            .list(folderPath, {
                search: fileName
            });

        if (listError || !listData || listData.length === 0 || !listData.find(f => f.name === fileName)) {
            return res.status(400).json({ message: 'Upload verification failed. File not found in storage.' });
        }

        const updatedFile = await prisma.file.update({
            where: { id: fileId },
            data: {
                status: 'READY',
                checksum: checksum || null
            }
        });

        res.status(200).json({
            message: 'Upload completed successfully',
            file: {
                id: updatedFile.id,
                name: updatedFile.name,
                status: updatedFile.status
            }
        });

    } catch (err) {
        console.error("COMPLETE UPLOAD ERROR:", err);
        if (err.name === 'ZodError') {
            return res.status(400).json({ message: 'Validation failed', errors: err.errors });
        }
        res.status(500).json({ message: 'Failed to complete upload' });
    }
};

// GET /files/:id
export const getFile = async (req, res) => {
    try {
        const file = req.resource; // From requireViewer middleware

        if (file.status !== 'READY') {
            return res.status(400).json({ message: 'File is not ready for download' });
        }

        // Generate a short-lived signed URL for downloading
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUrl(file.storageKey, 3600); // Expires in 1 hour (3600 seconds)

        if (error) {
            throw new Error(`Supabase download init failed: ${error.message}`);
        }

        res.status(200).json({
            file: {
                id: file.id,
                name: file.name,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
                createdAt: file.createdAt
            },
            signedUrl: data.signedUrl // The client will use this to actually download the file
        });

    } catch (err) {
        console.error("GET FILE ERROR:", err);
        res.status(500).json({ message: 'Failed to retrieve file' });
    }
};


const updateFileSchema = z.object({
    name: z.string().min(1).optional(),
    folderId: z.string().uuid().optional().nullable()
});

// PATCH /files/:id
export const updateFile = async (req, res) => {
    try {
        const validatedData = updateFileSchema.parse(req.body);
        const fileId = req.resource.id; // From requireEditor middleware

        // If moving the file, ensure the new folder allows editor access
        if (validatedData.folderId) {
            const result = await canAccessResource(req.user.id, 'FOLDER', validatedData.folderId, 'EDITOR');
            if (!result.granted) {
                return res.status(403).json({ message: 'Invalid target folder' });
            }
            if (result.resource.ownerId !== req.resource.ownerId) {
                return res.status(403).json({ message: 'Cannot move file across different owners' });
            }
        }

        const updatedFile = await prisma.file.update({
            where: { id: fileId },
            data: validatedData
        });

        res.status(200).json({ message: 'File updated', file: updatedFile });
    } catch (err) {
        console.error("UPDATE FILE ERROR:", err);
        res.status(500).json({ message: 'Failed to update file' });
    }
};

// DELETE /files/:id
export const deleteFile = async (req, res) => {
    try {
        const fileId = req.resource.id; // From requireEditor middleware

        await prisma.file.update({
            where: { id: fileId },
            data: { isDeleted: true, deletedAt: new Date() }
        });

        res.status(200).json({ message: 'File moved to trash' });
    } catch (err) {
        res.status(500).json({ message: 'Failed to delete file' });
    }
};
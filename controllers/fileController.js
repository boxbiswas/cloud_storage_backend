import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma.js';
import { supabase } from '../config/supabase.js';

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
    sizeBytes: z.number().max(MAX_FILE_SIZE, 'File size exceeds 50MB limit'),
    folderId: z.string().uuid().optional().nullable()
});

const completeUploadSchema = z.object({
    fileId: z.string().uuid(),
    checksum: z.string().optional()
});

// --- INLINE HELPERS ---
const sanitizeFilename = (filename) => {
    // Remove special characters, keep alphanumeric, dashes, underscores, and dots
    return filename.replace(/[^a-zA-Z0-9.\-_]/g, '').toLowerCase();
};

const BUCKET_NAME = process.env.SUPABASE_STORAGE_BUCKET || 'drive';

// --- CONTROLLER METHODS ---

// POST /api/files/init
export const initUpload = async (req, res) => {
    try {
        const validatedData = initUploadSchema.parse(req.body);
        const { name, mimeType, sizeBytes, folderId } = validatedData;
        const ownerId = req.user.id;

        // If folderId is provided, verify the user owns the folder
        if (folderId) {
            const folder = await prisma.folder.findUnique({ where: { id: folderId } });
            if (!folder || folder.ownerId !== ownerId) {
                return res.status(403).json({ message: 'Invalid or unauthorized folder' });
            }
        }

        const fileUuid = uuidv4();
        const slug = sanitizeFilename(name);
        const folderPath = folderId ? folderId : 'root';

        // Storage Key Format: tenants/{owner_id}/folders/{folder_id}/files/{file_uuid}-{slug}.{ext}
        const storageKey = `tenants/${ownerId}/folders/${folderPath}/files/${fileUuid}-${slug}`;

        // Create database record with UPLOADING status
        const newFile = await prisma.file.create({
            data: {
                id: fileUuid,
                name,
                mimeType,
                sizeBytes,
                storageKey,
                ownerId,
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

// POST /api/files/complete
export const completeUpload = async (req, res) => {
    try {
        const validatedData = completeUploadSchema.parse(req.body);
        const { fileId, checksum } = validatedData;
        const ownerId = req.user.id;

        // Verify the file exists, belongs to the user, and is currently UPLOADING
        const file = await prisma.file.findUnique({ where: { id: fileId } });

        if (!file || file.ownerId !== ownerId) {
            return res.status(404).json({ message: 'File not found or unauthorized' });
        }

        if (file.status !== 'UPLOADING') {
            return res.status(400).json({ message: 'File is not in uploading state' });
        }

        // In a production environment, you might verify the file actually exists 
        // in Supabase Storage here before marking it complete, but for MVP we update the DB.

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

// GET /api/files/:id
export const getFile = async (req, res) => {
    try {
        const { id } = req.params;
        const ownerId = req.user.id;

        const file = await prisma.file.findUnique({ where: { id } });

        // Basic ownership check for Day 3 (ACL checks for shared files will be added on Day 4/5)
        if (!file || file.ownerId !== ownerId || file.isDeleted) {
            return res.status(404).json({ message: 'File not found or unauthorized' });
        }

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
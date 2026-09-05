import { prisma } from '../lib/prisma.js';

// Core permission resolver
const ROLE_LEVEL = {
    VIEWER: 1,
    EDITOR: 2,
    OWNER: 3
};

const hasRequiredRole = (actualRole, requiredRole) => {
    if (requiredRole === 'OWNER') {
        return actualRole === 'OWNER';
    }

    return ROLE_LEVEL[actualRole] >= ROLE_LEVEL[requiredRole];
};

const getDirectShare = async (userId, resourceType, resourceId) => {
    return prisma.share.findFirst({
        where: {
            resourceType,
            resourceId,
            granteeUserId: userId
        },
        select: {
            role: true
        }
    });
};

const getFolderPermissionChain = async (userId, folderId) => {
    let currentFolderId = folderId;
    let strongestRole = null;

    const visited = new Set();

    while (currentFolderId) {
        // Protect against malformed/cyclic hierarchy.
        if (visited.has(currentFolderId)) {
            break;
        }

        visited.add(currentFolderId);

        const folder = await prisma.folder.findUnique({
            where: { id: currentFolderId },
            select: {
                id: true,
                ownerId: true,
                parentId: true,
                isDeleted: true
            }
        });

        if (!folder || folder.isDeleted) {
            break;
        }

        // Owner of folder has full access.
        if (folder.ownerId === userId) {
            strongestRole = 'OWNER';
            break;
        }

        const share = await getDirectShare(
            userId,
            'FOLDER',
            folder.id
        );

        if (
            share &&
            (
                !strongestRole ||
                ROLE_LEVEL[share.role] > ROLE_LEVEL[strongestRole]
            )
        ) {
            strongestRole = share.role;
        }

        currentFolderId = folder.parentId;
    }

    return strongestRole;
};

export const canAccessResource = async (
    userId,
    resourceType,
    resourceId,
    requiredRole
) => {
    try {
        let resource;

        if (resourceType === 'FILE') {
            resource = await prisma.file.findUnique({
                where: { id: resourceId }
            });
        } else if (resourceType === 'FOLDER') {
            resource = await prisma.folder.findUnique({
                where: { id: resourceId }
            });
        } else {
            return {
                granted: false,
                reason: 'Invalid resource type'
            };
        }

        if (!resource || resource.isDeleted) {
            return {
                granted: false,
                reason: 'Not found'
            };
        }

        // 1. Direct ownership.
        if (resource.ownerId === userId) {
            return {
                granted: true,
                role: 'OWNER',
                resource
            };
        }

        let strongestRole = null;

        // 2. Direct share on requested resource.
        const directShare = await getDirectShare(
            userId,
            resourceType,
            resourceId
        );

        if (directShare) {
            strongestRole = directShare.role;
        }

        // 3. Inherited permission from parent folders.
        let folderId = null;

        if (resourceType === 'FILE') {
            folderId = resource.folderId;
        } else {
            folderId = resource.parentId;
        }

        if (folderId) {
            const inheritedRole = await getFolderPermissionChain(
                userId,
                folderId
            );

            if (
                inheritedRole &&
                (
                    !strongestRole ||
                    ROLE_LEVEL[inheritedRole] >
                    ROLE_LEVEL[strongestRole]
                )
            ) {
                strongestRole = inheritedRole;
            }
        }

        if (!strongestRole) {
            return {
                granted: false,
                reason: 'Forbidden'
            };
        }

        if (!hasRequiredRole(strongestRole, requiredRole)) {
            return {
                granted: false,
                reason: `Requires ${requiredRole.toLowerCase()} permissions`
            };
        }

        return {
            granted: true,
            role: strongestRole,
            resource
        };
    } catch (error) {
        console.error('ACL RESOLUTION ERROR:', error);

        return {
            granted: false,
            reason: 'ACL verification failed'
        };
    }
};

// Reusable Middleware Generators
export const requireOwner = (resourceType) => async (req, res, next) => {
    try {
        const resourceId = req.params.id;
        const result = await canAccessResource(req.user.id, resourceType, resourceId, 'OWNER');

        if (!result.granted || result.resource.ownerId !== req.user.id) {
            if (result.reason === 'Not found') {
                return res.status(404).json({ message: 'Resource not found or already deleted' });
            }
            return res.status(403).json({ message: 'Only the owner can perform this action' });
        }

        req.resource = result.resource; // Pass resource to controller to save a DB call
        next();
    } catch (err) {
        res.status(500).json({ message: 'ACL verification failed' });
    }
};

export const requireEditor = (resourceType) => async (req, res, next) => {
    try {
        const resourceId = req.params.id;
        const result = await canAccessResource(req.user.id, resourceType, resourceId, 'EDITOR');

        if (!result.granted) {
            if (result.reason === 'Not found') {
                return res.status(404).json({ message: 'Resource not found or already deleted' });
            }
            return res.status(403).json({ message: 'Editor access required' });
        }

        req.resource = result.resource;
        next();
    } catch (err) {
        res.status(500).json({ message: 'ACL verification failed' });
    }
};

export const requireViewer = (resourceType) => async (req, res, next) => {
    try {
        const resourceId = req.params.id;
        const result = await canAccessResource(req.user.id, resourceType, resourceId, 'VIEWER');

        if (!result.granted) {
            if (result.reason === 'Not found') {
                return res.status(404).json({ message: 'Resource not found or already deleted' });
            }
            return res.status(403).json({ message: 'Viewer access required' });
        }

        req.resource = result.resource;
        next();
    } catch (err) {
        res.status(500).json({ message: 'ACL verification failed' });
    }
};
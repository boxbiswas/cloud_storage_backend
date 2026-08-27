import { prisma } from '../lib/prisma.js';

// Core permission resolver
export const canAccessResource = async (userId, resourceType, resourceId, requiredRole) => {
    // 1. Fetch the resource to check direct ownership
    let resource;
    if (resourceType === 'FILE') {
        resource = await prisma.file.findUnique({ where: { id: resourceId } });
    } else {
        resource = await prisma.folder.findUnique({ where: { id: resourceId } });
    }

    if (!resource || resource.isDeleted) {
        return { granted: false, reason: 'Not found' };
    }

    if (resource.ownerId === userId) {
        return { granted: true, resource }; // Owner has full access
    }

    // 2. Check explicit shares if not the owner
    const share = await prisma.share.findFirst({
        where: {
            resourceType,
            resourceId,
            granteeUserId: userId
        }
    });

    if (!share) {
        return { granted: false, reason: 'Forbidden' };
    }

    // Role hierarchy: Editor can do everything a Viewer can do
    if (requiredRole === 'EDITOR' && share.role !== 'EDITOR') {
        return { granted: false, reason: 'Requires editor permissions' };
    }

    return { granted: true, resource };
};

// Reusable Middleware Generators
export const requireOwner = (resourceType) => async (req, res, next) => {
    try {
        const resourceId = req.params.id;
        const result = await canAccessResource(req.user.id, resourceType, resourceId, 'OWNER');
        
        if (!result.granted || result.resource.ownerId !== req.user.id) {
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
            return res.status(403).json({ message: 'Viewer access required' });
        }
        
        req.resource = result.resource;
        next();
    } catch (err) {
        res.status(500).json({ message: 'ACL verification failed' });
    }
};
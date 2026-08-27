import express from 'express';
import { createLinkShare, resolveLinkShare, removeLinkShare } from '../controllers/linkShareController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = express.Router();

// PUBLIC ROUTE (No authentication required)
router.get('/:token', resolveLinkShare);

// PROTECTED ROUTES (Owner actions)
router.use(authenticate);
router.post('/', createLinkShare);
router.delete('/:id', removeLinkShare);

export default router;
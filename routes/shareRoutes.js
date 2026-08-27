import express from 'express';
import { createShare, listShares, removeShare } from '../controllers/shareController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authenticate);

router.post('/', createShare);
router.get('/:resourceType/:resourceId', listShares);
router.delete('/:id', removeShare);

export default router;
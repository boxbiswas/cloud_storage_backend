import express from 'express';
import { getTrash, restoreItem, permanentDelete, emptyTrash } from '../controllers/trashController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authenticate);

router.get('/', getTrash);
router.post('/restore', restoreItem);
router.post('/empty', emptyTrash);
router.delete('/:resourceType/:id', permanentDelete);

export default router;

import express from 'express';
import { initUpload, completeUpload, getFile, updateFile, deleteFile } from '../controllers/fileController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requireViewer, requireEditor } from '../middlewares/aclMiddleware.js';

const router = express.Router();

// All file routes are protected
router.use(authenticate);

router.post('/init', initUpload);
router.post('/complete', completeUpload);

// Apply ACL middleware to parameterized routes
router.get('/:id', requireViewer('FILE'), getFile);
router.patch('/:id', requireEditor('FILE'), updateFile);
router.delete('/:id', requireEditor('FILE'), deleteFile);

export default router;

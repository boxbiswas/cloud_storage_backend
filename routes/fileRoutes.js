import express from 'express';
import { initUpload, completeUpload, getFile } from '../controllers/fileController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = express.Router();

// All file routes are protected
router.use(authenticate);

router.post('/init', initUpload);
router.post('/complete', completeUpload);
router.get('/:id', getFile);

export default router;
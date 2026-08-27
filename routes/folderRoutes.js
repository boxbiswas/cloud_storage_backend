import express from 'express';
import { createFolder, getFolderContents, updateFolder, deleteFolder } from '../controllers/folderController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requireViewer, requireEditor } from '../middlewares/aclMiddleware.js';

const router = express.Router();

router.use(authenticate);

router.post('/', createFolder);
router.get('/:id', requireViewer('FOLDER'), getFolderContents);
router.patch('/:id', requireEditor('FOLDER'), updateFolder);
router.delete('/:id', requireEditor('FOLDER'), deleteFolder);

export default router;
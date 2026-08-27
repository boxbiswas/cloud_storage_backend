import express from 'express';
import { addStar, removeStar } from '../controllers/starController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authenticate);

router.post('/', addStar);
router.delete('/', removeStar);

export default router;
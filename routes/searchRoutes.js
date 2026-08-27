import express from 'express';
import { searchResources } from '../controllers/searchController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.use(authenticate);

router.get('/', searchResources);

export default router;
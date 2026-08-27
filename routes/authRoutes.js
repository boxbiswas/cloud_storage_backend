import express from 'express';
import { registerUser, loginUser, logoutUser, getCurrentUser, googleOAuth } from '../controllers/authController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.post('/google', googleOAuth);

// Protected route
router.get('/me', authenticate, getCurrentUser);

export default router;
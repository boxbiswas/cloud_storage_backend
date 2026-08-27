import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';


// const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// --- INLINE VALIDATORS ---
const registerSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters')
});

const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required')
});

// --- INLINE HELPERS ---
const generateToken = (user) => {
    return jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
    );
};

const setAuthCookie = (res, token) => {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax',
        secure: isProduction,
        maxAge: 24 * 60 * 60 * 1000 // 1 day
    });
};



// POST /auth/register
export const registerUser = async (req, res) => {
    try {
        const validatedData = registerSchema.parse(req.body);
        const { name, email, password } = validatedData;

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ message: 'Email already registered.' });
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const newUser = await prisma.user.create({
            data: {
                name,
                email,
                passwordHash,
                authProvider: 'LOCAL'
            },
        });

        const token = generateToken(newUser);
        setAuthCookie(res, token);

        res.status(201).json({
            message: 'User registered successfully',
            user: { id: newUser.id, name: newUser.name, email: newUser.email }
        });
    } catch (err) {
        console.error("REGISTER ERROR:", err);
        if (err.name === 'ZodError') {
            return res.status(400).json({ message: 'Validation failed', errors: err.errors });
        }
        res.status(500).json({ message: 'Something went wrong during registration' });
    }
};

// POST /api/auth/login
export const loginUser = async (req, res) => {
    try {
        const validatedData = loginSchema.parse(req.body);
        const { email, password } = validatedData;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const token = generateToken(user);
        setAuthCookie(res, token);

        res.status(200).json({
            message: 'Login successful',
            user: { id: user.id, name: user.name, email: user.email }
        });
    } catch (err) {
        console.error("LOGIN ERROR:", err);
        if (err.name === 'ZodError') {
            return res.status(400).json({ message: 'Validation failed', errors: err.errors });
        }
        res.status(500).json({ message: 'Something went wrong during login' });
    }
};

// POST /auth/logout
export const logoutUser = (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
    });
    res.status(200).json({ message: 'Logged out successfully' });
};

// GET /auth/me
export const getCurrentUser = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { id: true, name: true, email: true, imageUrl: true }
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({ user });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch user profile' });
    }
};


// POST /auth/google
export const googleOAuth = async (req, res) => {
    try {
        const { idToken } = req.body;
        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { email, name, sub: providerId, picture: imageUrl } = payload;

        let user = await prisma.user.findUnique({ where: { email } });

        // If user doesn't exist, register them via Google
        if (!user) {
            user = await prisma.user.create({
                data: {
                    email,
                    name,
                    imageUrl,
                    authProvider: 'GOOGLE',
                    providerId,
                }
            });
        }

        const token = generateToken(user);
        setAuthCookie(res, token);

        res.status(200).json({
            message: 'Google login successful',
            user: { id: user.id, name: user.name, email: user.email, imageUrl: user.imageUrl }
        });
    } catch (err) {
        console.error("GOOGLE OAUTH ERROR:", err);
        res.status(500).json({ message: 'Google authentication failed' });
    }
};
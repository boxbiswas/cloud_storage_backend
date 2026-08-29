import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';

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

        // Check if user already exists via Supabase REST (HTTPS, always works)
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .maybeSingle();

        if (existingUser) {
            return res.status(400).json({ message: 'Email already registered.' });
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const now = new Date().toISOString();
        const { data: newUser, error: insertError } = await supabase
            .from('users')
            .insert([{ id: crypto.randomUUID(), name, email, password_hash: passwordHash, auth_provider: 'LOCAL', created_at: now, updated_at: now }])
            .select()
            .single();

        if (insertError) {
            console.error('Supabase insert error:', insertError);
            throw new Error(insertError.message);
        }

        const token = generateToken(newUser);
        setAuthCookie(res, token);

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: { id: newUser.id, name: newUser.name, email: newUser.email }
        });
    } catch (err) {
        console.error('REGISTER ERROR:', err);
        if (err instanceof z.ZodError) {
            return res.status(400).json({
                message: 'Validation failed',
                errors: err.issues.map(issue => ({ message: issue.message }))
            });
        }
        res.status(500).json({ message: 'Something went wrong during registration', detail: err.message });
    }
};

// POST /auth/login
export const loginUser = async (req, res) => {
    try {
        const validatedData = loginSchema.parse(req.body);
        const { email, password } = validatedData;

        const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (!user || !user.password_hash) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        const token = generateToken(user);
        setAuthCookie(res, token);

        res.status(200).json({
            message: 'Login successful',
            token,
            user: { id: user.id, name: user.name, email: user.email }
        });
    } catch (err) {
        console.error('LOGIN ERROR:', err);
        if (err instanceof z.ZodError) {
            return res.status(400).json({
                message: 'Validation failed',
                errors: err.issues.map(issue => ({ message: issue.message }))
            });
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
        const { data: user } = await supabase
            .from('users')
            .select('id, name, email, image_url')
            .eq('id', req.user.id)
            .maybeSingle();

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json({ user });
    } catch (err) {
        console.error('GET ME ERROR:', err);
        res.status(500).json({ message: 'Failed to fetch user profile' });
    }
};

// POST /auth/google (placeholder — requires Google OAuth setup)
export const googleOAuth = async (req, res) => {
    res.status(501).json({ message: 'Google OAuth not yet configured' });
};
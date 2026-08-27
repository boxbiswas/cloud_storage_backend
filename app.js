import "dotenv/config";
import express from 'express';

import cookieParser from 'cookie-parser';
import cors from 'cors';

import { prisma } from "./lib/prisma.js";

const app = express();

// Cors configuration
// app.use(cors({
//     origin: [
//         "http://localhost:5173",
//         "https://quiz-management-frontend-gamma.vercel.app"
//     ],
//     credentials: true, // This allows the cookies to be sent back and forth
//     methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//     allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Cookie']
// }))




app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Import routes
import authRoutes from './routes/authRoutes.js';




app.use('/api/auth', authRoutes);


const PORT = process.env.PORT;

// Explicitly bind to 0.0.0.0 so Railway's proxy can route traffic to it
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);
});
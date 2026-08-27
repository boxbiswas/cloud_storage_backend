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
import fileRoutes from './routes/fileRoutes.js';
import folderRoutes from './routes/folderRoutes.js';
import shareRoutes from './routes/shareRoutes.js';
import linkRoutes from './routes/linkRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
import starRoutes from './routes/starRoutes.js';


app.use('/auth', authRoutes);
app.use('/files', fileRoutes);
app.use('/folders', folderRoutes);
app.use('/shares', shareRoutes);
app.use('/search', searchRoutes);
app.use('/stars', starRoutes);

// It specifically distinguishes the creation endpoint from the resolution endpoint
app.use('/link-shares', linkRoutes); // Maps POST and DELETE
app.use('/link', linkRoutes);        // Maps the GET /:token (can point to the same router)



const PORT = process.env.PORT;


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
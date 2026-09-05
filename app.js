import "dotenv/config";
import express from 'express';

import cookieParser from 'cookie-parser';
import cors from 'cors';

import { prisma } from "./lib/prisma.js";

BigInt.prototype.toJSON = function () {
    return this.toString();
};

const app = express();

// Cors configuration
app.use(cors({
    origin: [
        "http://localhost:5173"
    ],
    credentials: true, // This allows the cookies to be sent back and forth
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Cookie']
}))




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
import trashRoutes from './routes/trashRoutes.js';


app.use('/auth', authRoutes);
app.use('/files', fileRoutes);
app.use('/folders', folderRoutes);
app.use('/shares', shareRoutes);
app.use('/search', searchRoutes);
app.use('/stars', starRoutes);
app.use('/trash', trashRoutes);

// It specifically distinguishes the creation endpoint from the resolution endpoint
app.use('/link-shares', linkRoutes); // Maps POST and DELETE
app.use('/link', linkRoutes);        // Maps the GET /:token (can point to the same router)



import { purgeExpiredTrash } from './lib/purgeTrash.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    
    // Retention purge logic (30 days)
    // Run once every 24 hours (24 * 60 * 60 * 1000)
    setInterval(purgeExpiredTrash, 24 * 60 * 60 * 1000);
});
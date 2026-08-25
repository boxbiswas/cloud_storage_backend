import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const { Pool } = pg;

// Grab the direct connection string from your .env file
const connectionString = process.env.DATABASE_URL;

// Initialize the Postgres connection pool
const pool = new Pool({ connectionString });

// Create the Prisma adapter
const adapter = new PrismaPg(pool);

// Initialize Prisma Client with the mandatory adapter option
const prisma = new PrismaClient({ adapter });

export { prisma };
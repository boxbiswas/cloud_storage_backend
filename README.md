# ☁️ CloudVault — Backend API

> A robust, production-grade REST API for a full-featured cloud file storage service. Built with **Node.js**, **Express 5**, **Prisma ORM**, and **Supabase Storage** — deployed on **Render**.

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#%EF%B8%8F-architecture)
- [Database Schema](#%EF%B8%8F-database-schema)
- [Tech Stack](#%EF%B8%8F-tech-stack)
- [Quick Start](#-quick-start)
- [Project Structure](#-project-structure)
- [API Reference](#-api-reference)
- [Security](#-security)
- [Deployment](#-deployment)

---

## 🔍 Overview

CloudVault's backend provides a comprehensive API for a cloud storage application similar to Google Drive. It handles:

- **User authentication** via email/password (JWT httpOnly cookies) and Google OAuth 2.0
- **Hierarchical file system** — nested folders, file uploads/downloads via Supabase signed URLs
- **Granular permission system** — owner, editor, and viewer roles with hierarchical inheritance
- **Sharing** — both user-to-user sharing and public link generation (with optional passwords and expiry)
- **Soft-delete trash system** — items are soft-deleted and permanently purged after 30 days
- **Full-text search** — across owned and shared files/folders with filtering and cursor-based pagination
- **Starring/Bookmarks** — mark any file or folder as a favourite

---

## 🏗️ Architecture

```
Client Request
     │
     ▼
Express 5 App (app.js)
     │
     ├── CORS (origin whitelist: localhost:5173 + Vercel)
     ├── Helmet (security headers)
     ├── Cookie Parser
     ├── Rate Limiter
     │
     ▼
Route Handlers (routes/)
     │
     ├── authMiddleware   → JWT verification + req.user injection
     ├── aclMiddleware    → Role-based access control (OWNER / EDITOR / VIEWER)
     │
     ▼
Controllers (controllers/)
     │
     ├── Zod validation on every request body
     ├── Prisma ORM → PostgreSQL (Neon)
     └── Supabase SDK → Object Storage (signed URLs)
```

### Upload Flow

```
1. Client → POST /files/init (name, mimeType, sizeBytes, folderId?)
       └─ Creates DB record (status: UPLOADING) + generates Supabase signed upload URL
2. Client → PUT {signedUrl} (direct binary upload to Supabase CDN)
3. Client → POST /files/complete (fileId, checksum?)
       └─ Verifies file exists in Supabase + marks DB record as READY
```

### Permission Resolution (ACL)

The `aclMiddleware.js` resolves permissions via a 3-step chain:

```
1. Direct Ownership       → resource.ownerId === userId → OWNER
2. Direct Share Record    → shares table lookup for this resource → EDITOR | VIEWER
3. Inherited Permission   → traverse parentId chain up the folder tree → inherits strongest role
```

---

## 🗄️ Database Schema

Built with **Prisma ORM** on **Neon PostgreSQL** (serverless).

### Models

| Model | Description |
|---|---|
| `User` | Auth accounts (local + Google OAuth). Stores `passwordHash`, `imageUrl`, `authProvider`. |
| `Session` | Refresh token sessions with expiry and revocation tracking. |
| `Folder` | Hierarchical folders via `parentId` self-reference. Soft-deleted via `isDeleted`. |
| `File` | File records linking to Supabase storage via `storageKey`. Stateful: `UPLOADING → READY`. |
| `Share` | User-to-user shares. Composite unique on `(resourceType, resourceId, granteeUserId)`. |
| `LinkShare` | Public token-based shares. Supports password hash and expiry datetime. |
| `Star` | Bookmarks. Composite primary key on `(userId, resourceType, resourceId)`. |

### Enums

| Enum | Values |
|---|---|
| `AuthProvider` | `LOCAL`, `GOOGLE` |
| `FileStatus` | `UPLOADING`, `READY`, `FAILED` |
| `ResourceType` | `FILE`, `FOLDER` |
| `ShareRole` | `VIEWER`, `EDITOR` |
| `LinkRole` | `VIEWER` |

### Role Hierarchy

```
OWNER (3) > EDITOR (2) > VIEWER (1)
```
Permissions are inherited from parent folders up the folder tree.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ES Modules) |
| Framework | Express 5 |
| ORM | Prisma 7 |
| Database | Neon (serverless PostgreSQL) |
| File Storage | Supabase Storage (S3-compatible) |
| Auth | JWT (`jsonwebtoken`) + `bcrypt` + Google OAuth 2.0 |
| Validation | Zod |
| Security | `helmet`, `express-rate-limit` |
| Dev Tools | `nodemon` |
| Deployment | Render (Web Service) |

---

## ⚡ Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- A **[Neon](https://neon.tech/)** account (free tier works) — no local PostgreSQL needed
- A **[Supabase](https://supabase.com/)** project with a storage bucket
- A **Google Cloud** project with OAuth 2.0 credentials (for Google login)

### Installation

```bash
# Clone the repository
git clone https://github.com/boxbiswas/cloud_storage_backend.git
cd cloud_storage_backend

# Install dependencies
npm install

### Database Setup

```bash
# Apply schema to your Neon database
npx prisma migrate dev --name init

# (Optional) Open Prisma Studio to browse data
npx prisma studio
```

### Run the Server

```bash
# Development (with hot-reload via nodemon)
npm run dev

# Production
npm start
```

API available at: `http://localhost:3000`

---

## 📁 Project Structure

```
backend/
│
├── app.js                    # Entry point: Express setup, CORS, middleware, route mounting
│
├── controllers/
│   ├── authController.js     # register, login, logout, /me, Google OAuth callback
│   ├── fileController.js     # initUpload, completeUpload, getFile, updateFile, deleteFile
│   ├── folderController.js   # createFolder, getFolderContents, updateFolder, deleteFolder
│   ├── shareController.js    # createShare, listShares, removeShare
│   ├── linkShareController.js# createLinkShare, resolveLinkShare (public), removeLinkShare
│   ├── searchController.js   # searchResources (full-text, filtered, cursor-paginated)
│   ├── starController.js     # addStar, removeStar
│   └── trashController.js    # getTrash, restoreItem, permanentlyDelete
│
├── middlewares/
│   ├── authMiddleware.js     # JWT verification → req.user
│   └── aclMiddleware.js      # requireOwner / requireEditor / requireViewer generators
│                               # canAccessResource (ownership + direct share + inherited)
│
├── routes/
│   ├── authRoutes.js         # /auth/*
│   ├── fileRoutes.js         # /files/*
│   ├── folderRoutes.js       # /folders/*
│   ├── shareRoutes.js        # /shares/*
│   ├── linkRoutes.js         # /link-shares/* and /link/:token (public)
│   ├── searchRoutes.js       # /search
│   ├── starRoutes.js         # /stars
│   └── trashRoutes.js        # /trash/*
│
├── lib/
│   ├── prisma.js             # Prisma Client singleton (with @prisma/adapter-pg for Neon)
│   └── purgeTrash.js         # Scheduled job: permanently deletes 30-day-old trash from DB + Supabase
│
├── config/
│   └── supabase.js           # Supabase client initialization
│
└── prisma/
    ├── schema.prisma         # Full database schema definition
    └── migrations/           # SQL migration history
```

---

## 🔌 API Reference

All authenticated routes require the `token` httpOnly cookie set at login. CORS is configured to accept requests from `http://localhost:5173` and `https://cloud-storage-frontend-phi.vercel.app`.

### 🔐 Auth — `/auth`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/auth/register` | Create a new user account | ❌ |
| `POST` | `/auth/login` | Log in; sets `token` httpOnly cookie | ❌ |
| `POST` | `/auth/logout` | Clears the session cookie | ✅ |
| `GET` | `/auth/me` | Get the current authenticated user | ✅ |
| `POST` | `/auth/google` | Google ID token verification → sets session cookie | ❌ |

### 📁 Folders — `/folders`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/folders/:id` | Get folder contents (subfolders + files). `id=root` returns root. | ✅ |
| `POST` | `/folders` | Create a new folder | ✅ |
| `PATCH` | `/folders/:id` | Rename or move a folder (requires Editor) | ✅ |
| `DELETE` | `/folders/:id` | Soft-delete folder (move to trash) | ✅ |

### 📄 Files — `/files`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/files/init` | Step 1: Initialize upload → returns Supabase signed URL | ✅ |
| `POST` | `/files/complete` | Step 2: Confirm upload complete → status set to READY | ✅ |
| `GET` | `/files/:id` | Get file metadata + a 1-hour signed download URL | ✅ |
| `PATCH` | `/files/:id` | Rename or move a file (requires Editor) | ✅ |
| `DELETE` | `/files/:id` | Soft-delete file (move to trash) | ✅ |

### 🔗 Sharing — `/shares`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/shares` | Share a file or folder with another user by email | ✅ |
| `GET` | `/shares/:resourceType/:resourceId` | List all shares for a resource (owner only) | ✅ |
| `DELETE` | `/shares/:id` | Revoke a user's share access | ✅ |

### 🌐 Public Links — `/link-shares` & `/link`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/link-shares` | Create a public link (optional password + expiry) | ✅ |
| `DELETE` | `/link-shares/:id` | Revoke a public link | ✅ |
| `GET` | `/link/:token` | **Public** — Resolve a link token → returns file/folder data | ❌ |

> Password-protected links require the `x-link-password` header.

### 🔍 Search — `/search`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/search` | Full-text search across owned + shared resources | ✅ |

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `q` | string | Search query (case-insensitive, partial match) |
| `type` | string | `folder`, `pdf`, `image`, `document` |
| `owner` | string | `me` or a specific user UUID |
| `starred` | boolean | Filter to starred items only |
| `shared` | boolean | Filter to items shared with you |
| `sort` | string | `name`, `createdAt`, `updatedAt`, `sizeBytes` |
| `order` | string | `asc` \| `desc` |
| `limit` | number | Results per page (default: 20) |
| `fileCursor` | UUID | Cursor for file pagination |
| `folderCursor` | UUID | Cursor for folder pagination |

### ⭐ Stars — `/stars`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/stars` | Star a file or folder | ✅ |
| `DELETE` | `/stars` | Un-star a file or folder | ✅ |

### 🗑️ Trash — `/trash`

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/trash` | List all trashed items (top-level only) | ✅ |
| `POST` | `/trash/restore` | Restore a trashed item | ✅ |
| `DELETE` | `/trash/:resourceType/:resourceId` | Permanently delete an item + remove from Supabase storage | ✅ |

---

## 🔒 Security

- **httpOnly Cookies** — JWT tokens are never exposed to JavaScript; `SameSite=None; Secure=true` for cross-origin (Vercel → Render).
- **Helmet** — Sets standard security headers (`X-Content-Type-Options`, `X-Frame-Options`, etc.).
- **Rate Limiting** — `express-rate-limit` protects all endpoints from abuse.
- **Zod Validation** — Every request body is validated with strict Zod schemas before hitting the database.
- **ACL Middleware** — Every file/folder mutation checks `requireOwner`, `requireEditor`, or `requireViewer` before proceeding.
- **Signed URLs** — Files are never served directly; all downloads/previews use short-lived (1-hour) Supabase signed URLs.
- **Soft Deletes** — Files are never immediately deleted. A scheduled `setInterval` runs `purgeExpiredTrash` every 24 hours to permanently remove 30-day-old items from both PostgreSQL and Supabase Storage.

---

## 🚀 Deployment (Render)

1. Connect your GitHub repository to a new Render **Web Service**.
2. Set the following environment variables in the Render dashboard:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Neon connection string (with `?sslmode=require`) |
| `JWT_SECRET` | Your secret key (64+ chars) |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key |
| `SUPABASE_STORAGE_BUCKET` | `drive` (or your bucket name) |
| `GOOGLE_CLIENT_ID` | Your Google OAuth Client ID |
| `NODE_ENV` | `production` |

3. **Build Command:** `npm install` (Prisma Client is auto-generated via `postinstall` script)
4. **Start Command:** `npm start`

> **CORS Note:** If you deploy the frontend under a different URL, add it to the `origin` array in `app.js`.

---

Made with ❤️ by [Indranil Biswas](https://github.com/boxbiswas)

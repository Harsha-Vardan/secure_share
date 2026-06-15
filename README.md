# 🔐 SecureShare

A full-stack secure file sharing platform where files are **encrypted on the client before upload** — the server never sees plaintext data or encryption keys.

## ✨ Features

- **AES-256-GCM Client-Side Encryption** — Files are encrypted in the browser using the Web Crypto API before being transmitted.
- **Time-Limited Share Links** — Generated links expire after a configurable duration.
- **Download Limits** — Restrict how many times a file can be downloaded.
- **JWT Authentication** — Secure login/registration with username, email, and bcrypt-hashed passwords.
- **Zero-Knowledge Architecture** — Encryption keys are kept strictly client-side. The key is shared out-of-band separately from the download link, preventing confidentiality leakage.
- **Active Share Link Tracking** — Monitor all generated share links, remaining downloads, and active time-to-live (TTL) countdown timers right from the dashboard.

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, TypeScript, Tailwind CSS |
| Backend | Node.js, Express 5 |
| Database | MongoDB (Mongoose) |
| Encryption | Web Crypto API (AES-GCM-256) |
| Auth | JWT + bcrypt |

## 📁 Project Structure

```
secure_share/
├── backend/
│   ├── index.js              # Express app entry point
│   ├── middleware/
│   │   └── auth.js           # JWT authentication middleware
│   ├── routes/
│   │   ├── auth.js           # POST /auth/register, /auth/login
│   │   ├── files.js          # POST /files/upload, GET /files, DELETE /files/:id
│   │   └── share.js          # POST /share/create, GET /share/download/:token
│   └── prisma/
│       └── schema.prisma     # Database models
└── frontend/
    └── src/
        ├── app/
        │   ├── login/        # Login page
        │   ├── register/     # Registration page
        │   ├── dashboard/    # Main file manager
        │   └── download/     # Secure download & decrypt page
        ├── context/
        │   └── AuthContext.tsx  # Global auth state
        └── lib/
            ├── api.ts           # Axios client
            └── encryption.ts    # Web Crypto AES-GCM utilities
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm

### 1. Clone the repo

```bash
git clone https://github.com/Harsha-Vardan/secure_share.git
cd secure_share
```

### 2. Backend setup

Configure `backend/.env` with your MongoDB connection string (`MONGODB_URI`), then run:

```bash
cd backend
npm install
npm start            # Runs on http://localhost:3001
```

### 3. Frontend setup

```bash
cd frontend
npm install
npm run dev          # Runs on http://localhost:3000
```

### Or — launch both at once (Windows)

```powershell
.\start.ps1
```

## 🔒 How Encryption Works

```
User selects file
      │
      ▼
AES-256-GCM key generated locally (Web Crypto API)
      │
      ▼
File encrypted in the browser (IV stored on server, key stays local)
      │
      ▼
Encrypted blob uploaded to backend → stored on disk
      │
      ▼
Share link generated (e.g. https://app.com/download/{token})
      │
      ▼
Decryption key displayed separately on Dashboard for copy/pasting
      │
      ▼
Key shared with recipient via separate secure channel (e.g., chat, SMS)
```

The recipient enters the decryption key manually on the download page. Since the encryption key is never included in the share link, even if the link is intercepted or leaks (e.g., via chat logs or browser history), the file remains completely secure. The server never has access to the plaintext file or the key.

## 📡 API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | ❌ | Register a new user |
| POST | `/auth/login` | ❌ | Login, receive JWT |
| POST | `/files/upload` | ✅ | Upload encrypted file |
| GET | `/files` | ✅ | List user's files |
| DELETE | `/files/:id` | ✅ | Delete a file |
| POST | `/share/create` | ✅ | Create a share link |
| GET | `/share/download/:token` | ❌ | Download encrypted file |

## ⚙️ Environment Variables

**Backend** (`backend/.env`):
```env
MONGODB_URI="mongodb://localhost:27017/secureshare"
PORT=3001
JWT_SECRET="your-secret-here"
FRONTEND_URL="http://localhost:3000"
```

**Frontend** (`frontend/.env.local`):
```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

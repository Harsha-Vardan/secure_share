# 🔐 SecureShare

A full-stack secure file sharing platform where files are **encrypted on the client before upload** — the server never sees plaintext data or encryption keys.

## ✨ Features

- **AES-256-GCM Client-Side Encryption** — Files are encrypted in the browser using the Web Crypto API before being transmitted
- **Time-Limited Share Links** — Generated links expire after a configurable duration
- **Download Limits** — Restrict how many times a file can be downloaded
- **JWT Authentication** — Secure login/registration with bcrypt-hashed passwords
- **Zero-Knowledge Architecture** — Encryption keys live only in the share link hash (`#key=...`) and are never sent to the server

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, TypeScript, Tailwind CSS |
| Backend | Node.js, Express 5 |
| Database | SQLite via Prisma ORM |
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

```bash
cd backend
npm install
npx prisma db push   # Creates the SQLite database
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
Share link generated:
  https://app.com/download/{token}#key={base64-aes-key}
                                   ↑
                          URL fragment: never sent to server
```

When downloading, the browser reads the `#key` fragment locally and uses it to decrypt the downloaded blob — the server only ever sees encrypted bytes.

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
DATABASE_URL="file:./prisma/dev.db"
PORT=3001
JWT_SECRET="your-secret-here"
FRONTEND_URL="http://localhost:3000"
```

**Frontend** (`frontend/.env.local`):
```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

## 📄 License

MIT

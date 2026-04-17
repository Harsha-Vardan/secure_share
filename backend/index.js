const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// ─── Directory Setup ──────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'uploads');
const logsDir = path.join(__dirname, 'logs');
const chunkDir = path.join(uploadDir, 'chunks');

[uploadDir, logsDir, chunkDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    exposedHeaders: ['X-File-Name', 'X-File-IV', 'X-File-Hash', 'X-File-Size'],
}));

app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth', require('./routes/auth'));
app.use('/files', require('./routes/files'));
app.use('/share', require('./routes/share'));
app.use('/chunks', require('./routes/chunks'));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        features: ['aes-256-encryption', 'chunked-transfer', 'integrity-verification', 'password-protected-links', 'activity-logging']
    });
});

// ─── Activity log viewer (last 100 entries) ───────────────────────────────────
app.get('/admin/logs', async (req, res) => {
    try {
        const logs = await prisma.activityLog.findMany({
            orderBy: { created_at: 'desc' },
            take: 100,
        });
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve logs' });
    }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║      🔐 Secure File Transfer Platform            ║
║      Running on http://localhost:${PORT}           ║
╠══════════════════════════════════════════════════╣
║  Features:                                       ║
║   ✅ AES-256 End-to-End Encryption               ║
║   ✅ Chunked Parallel File Transfer              ║
║   ✅ SHA-256 Integrity Verification              ║
║   ✅ Password-Protected Share Links              ║
║   ✅ JWT Authentication                          ║
║   ✅ Activity Logging                            ║
╚══════════════════════════════════════════════════╝
`);
});

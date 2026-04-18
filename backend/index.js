const express = require('express');
const cors    = require('cors');
const dotenv  = require('dotenv');
const fs      = require('fs');
const path    = require('path');
const { connectDB } = require('./db');

dotenv.config();

const app = express();

// ─── Directory Setup ──────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'uploads');
const logsDir   = path.join(__dirname, 'logs');
const chunkDir  = path.join(uploadDir, 'chunks');

[uploadDir, logsDir, chunkDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-File-Name', 'X-File-IV', 'X-File-Hash', 'X-File-Size'],
}));

app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth',   require('./routes/auth'));
app.use('/files',  require('./routes/files'));
app.use('/share',  require('./routes/share'));
app.use('/chunks', require('./routes/chunks'));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    const mongoose = require('mongoose');
    res.json({
        status: 'ok',
        db:     mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
        features: ['aes-256-encryption', 'chunked-transfer', 'integrity-verification', 'password-protected-links', 'activity-logging', 'mongodb'],
    });
});

// ─── Activity log viewer (last 100 entries) ───────────────────────────────────
app.get('/admin/logs', async (req, res) => {
    try {
        const ActivityLog = require('./models/ActivityLog');
        const logs = await ActivityLog.find().sort({ created_at: -1 }).limit(100);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve logs' });
    }
});

// ─── Connect DB, then start server ───────────────────────────────────────────
const PORT = process.env.PORT || 3001;

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`
╔══════════════════════════════════════════════════╗
║      🔐 Secure File Transfer Platform            ║
║      Running on http://localhost:${PORT}           ║
╠══════════════════════════════════════════════════╣
║  Database: MongoDB (Mongoose)                    ║
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
});

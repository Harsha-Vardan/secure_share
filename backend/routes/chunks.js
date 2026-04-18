const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const File     = require('../models/File');
const authenticateToken = require('../middleware/auth');
const { log } = require('../logger');

const CHUNK_DIR = path.join(__dirname, '..', 'uploads', 'chunks');
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });

// ─── Multer: chunk storage ────────────────────────────────────────────────────
const chunkStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const sessionId = req.body.sessionId || req.headers['x-session-id'];
        if (!sessionId) return cb(new Error('sessionId is required'));
        const sessionDir = path.join(CHUNK_DIR, sessionId);
        fs.mkdirSync(sessionDir, { recursive: true });
        cb(null, sessionDir);
    },
    filename: (req, file, cb) => {
        const idx = req.body.chunkIndex || req.headers['x-chunk-index'] || '0';
        cb(null, `chunk_${String(idx).padStart(6, '0')}`);
    },
});

const chunkUpload = multer({ storage: chunkStorage });

// ─── POST /chunks/upload ─────────────────────────────────────────────────────
router.post('/upload', authenticateToken, chunkUpload.single('chunk'), async (req, res) => {
    try {
        const { sessionId, chunkIndex, totalChunks } = req.body;

        if (!req.file) return res.status(400).json({ error: 'No chunk data' });
        if (!sessionId || chunkIndex === undefined || !totalChunks) {
            return res.status(400).json({ error: 'sessionId, chunkIndex, totalChunks are required' });
        }

        await log({ event: 'chunk_upload', userId: req.user.id, detail: `session=${sessionId} chunk=${chunkIndex}/${totalChunks}`, ip: req.ip });

        res.json({ message: 'Chunk received', chunkIndex: parseInt(chunkIndex), sessionId });
    } catch (err) {
        console.error('[chunks/upload]', err);
        res.status(500).json({ error: 'Failed to store chunk' });
    }
});

// ─── POST /chunks/finalize ────────────────────────────────────────────────────
router.post('/finalize', authenticateToken, async (req, res) => {
    const { sessionId, totalChunks, filename, iv } = req.body;

    if (!sessionId || !totalChunks || !filename || !iv) {
        return res.status(400).json({ error: 'sessionId, totalChunks, filename, iv are required' });
    }

    const sessionDir = path.join(CHUNK_DIR, sessionId);
    const finalPath  = path.join(__dirname, '..', 'uploads', `${sessionId}-${filename}`);

    try {
        // Verify all chunks present
        const missing = [];
        for (let i = 0; i < parseInt(totalChunks); i++) {
            const p = path.join(sessionDir, `chunk_${String(i).padStart(6, '0')}`);
            if (!fs.existsSync(p)) missing.push(i);
        }
        if (missing.length > 0) {
            return res.status(400).json({ error: `Missing chunks: ${missing.join(', ')}` });
        }

        // Reassemble
        const writeStream = fs.createWriteStream(finalPath);
        for (let i = 0; i < parseInt(totalChunks); i++) {
            const chunkPath = path.join(sessionDir, `chunk_${String(i).padStart(6, '0')}`);
            writeStream.write(fs.readFileSync(chunkPath));
        }
        await new Promise((resolve, reject) => {
            writeStream.end();
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });

        fs.rmSync(sessionDir, { recursive: true, force: true });

        const fileBuffer = fs.readFileSync(finalPath);
        const fileHash   = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        const fileRecord = await File.create({
            user_id:             req.user.id,
            filename,
            encrypted_file_path: finalPath,
            iv,
            file_hash:   fileHash,
            file_size:   fileBuffer.length,
            chunk_count: parseInt(totalChunks),
        });

        await log({ event: 'upload', userId: req.user.id, fileId: fileRecord.id, detail: `chunks=${totalChunks} size=${fileBuffer.length} hash=${fileHash.slice(0, 12)}...`, ip: req.ip });

        res.status(201).json({ message: 'File assembled successfully', file: fileRecord });
    } catch (err) {
        console.error('[chunks/finalize]', err);
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
        res.status(500).json({ error: 'Failed to finalize chunked upload' });
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const authenticateToken = require('../middleware/auth');
const { log } = require('../logger');

const prisma = new PrismaClient();

// ─── Chunk storage ───────────────────────────────────────────────────────────
const CHUNK_DIR = path.join(__dirname, '..', 'uploads', 'chunks');
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });

const chunkStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const sessionId = req.body.sessionId || req.headers['x-session-id'];
        if (!sessionId) return cb(new Error('sessionId is required'));
        const sessionDir = path.join(CHUNK_DIR, sessionId);
        fs.mkdirSync(sessionDir, { recursive: true });
        cb(null, sessionDir);
    },
    filename: (req, file, cb) => {
        const chunkIndex = req.body.chunkIndex || req.headers['x-chunk-index'] || '0';
        cb(null, `chunk_${String(chunkIndex).padStart(6, '0')}`);
    }
});

const chunkUpload = multer({ storage: chunkStorage });

// ─── POST /chunks/upload ─────────────────────────────────────────────────────
// Upload a single encrypted chunk.
// Body (multipart): file, sessionId, chunkIndex, totalChunks
router.post('/upload', authenticateToken, chunkUpload.single('chunk'), async (req, res) => {
    try {
        const { sessionId, chunkIndex, totalChunks } = req.body;

        if (!req.file) return res.status(400).json({ error: 'No chunk data received' });
        if (!sessionId || chunkIndex === undefined || !totalChunks) {
            return res.status(400).json({ error: 'sessionId, chunkIndex, totalChunks are required' });
        }

        await log({
            event: 'chunk_upload',
            userId: req.user.id,
            detail: `session=${sessionId} chunk=${chunkIndex}/${totalChunks}`,
            ip: req.ip,
        });

        res.json({
            message: 'Chunk received',
            chunkIndex: parseInt(chunkIndex),
            sessionId
        });
    } catch (err) {
        console.error('[chunks/upload]', err);
        res.status(500).json({ error: 'Failed to store chunk' });
    }
});

// ─── POST /chunks/finalize ───────────────────────────────────────────────────
// Reassemble all chunks, compute SHA-256 hash, create File DB record.
// Body (JSON): sessionId, totalChunks, filename, iv
router.post('/finalize', authenticateToken, async (req, res) => {
    const { sessionId, totalChunks, filename, iv } = req.body;

    if (!sessionId || !totalChunks || !filename || !iv) {
        return res.status(400).json({ error: 'sessionId, totalChunks, filename, iv are required' });
    }

    const sessionDir = path.join(CHUNK_DIR, sessionId);
    const finalPath = path.join(__dirname, '..', 'uploads', `${sessionId}-${filename}`);

    try {
        // Verify all chunks exist
        const missingChunks = [];
        for (let i = 0; i < parseInt(totalChunks); i++) {
            const chunkPath = path.join(sessionDir, `chunk_${String(i).padStart(6, '0')}`);
            if (!fs.existsSync(chunkPath)) missingChunks.push(i);
        }
        if (missingChunks.length > 0) {
            return res.status(400).json({ error: `Missing chunks: ${missingChunks.join(', ')}` });
        }

        // Reassemble — stream chunks into final file
        const writeStream = fs.createWriteStream(finalPath);
        for (let i = 0; i < parseInt(totalChunks); i++) {
            const chunkPath = path.join(sessionDir, `chunk_${String(i).padStart(6, '0')}`);
            const chunkData = fs.readFileSync(chunkPath);
            writeStream.write(chunkData);
        }
        await new Promise((resolve, reject) => {
            writeStream.end();
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });

        // Cleanup chunk directory
        fs.rmSync(sessionDir, { recursive: true, force: true });

        // Compute SHA-256 of the assembled encrypted file
        const fileBuffer = fs.readFileSync(finalPath);
        const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        const fileSize = fileBuffer.length;

        // Persist file record
        const fileRecord = await prisma.file.create({
            data: {
                user_id: req.user.id,
                filename,
                encrypted_file_path: finalPath,
                iv,
                file_hash: fileHash,
                file_size: fileSize,
                chunk_count: parseInt(totalChunks),
            }
        });

        await log({
            event: 'upload',
            userId: req.user.id,
            fileId: fileRecord.id,
            detail: `chunks=${totalChunks} size=${fileSize} hash=${fileHash.slice(0, 12)}...`,
            ip: req.ip,
        });

        res.status(201).json({
            message: 'File assembled and stored successfully',
            file: fileRecord
        });
    } catch (err) {
        console.error('[chunks/finalize]', err);
        // Cleanup partial file if it exists
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
        res.status(500).json({ error: 'Failed to finalize chunked upload' });
    }
});

module.exports = router;

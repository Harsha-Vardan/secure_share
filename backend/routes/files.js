const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const authenticateToken = require('../middleware/auth');
const { log } = require('../logger');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// ─── Multer config ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 } // 500 MB limit for single-shot uploads
});

// ─── POST /files/upload ───────────────────────────────────────────────────────
// Standard (non-chunked) upload. File is pre-encrypted by client (AES-GCM).
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const { iv } = req.body;
        if (!iv) return res.status(400).json({ error: 'Initialization vector (iv) is required' });

        // Compute SHA-256 integrity hash of the encrypted blob
        const fileBuffer = fs.readFileSync(req.file.path);
        const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        const fileRecord = await prisma.file.create({
            data: {
                user_id: req.user.id,
                filename: req.file.originalname,
                encrypted_file_path: req.file.path,
                iv,
                file_hash: fileHash,
                file_size: fileBuffer.length,
                chunk_count: 1,
            }
        });

        await log({
            event: 'upload',
            userId: req.user.id,
            fileId: fileRecord.id,
            detail: `size=${fileBuffer.length} hash=${fileHash.slice(0, 12)}... mode=single`,
            ip: req.ip,
        });

        res.status(201).json({ message: 'File uploaded successfully', file: fileRecord });
    } catch (error) {
        console.error('[files/upload]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /files ───────────────────────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
    try {
        const files = await prisma.file.findMany({
            where: { user_id: req.user.id },
            orderBy: { created_at: 'desc' },
            select: {
                id: true,
                filename: true,
                file_hash: true,
                file_size: true,
                chunk_count: true,
                created_at: true,
            }
        });
        res.json(files);
    } catch (error) {
        console.error('[files/list]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── DELETE /files/:id ────────────────────────────────────────────────────────
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const fileId = req.params.id;
        const fileRecord = await prisma.file.findUnique({ where: { id: fileId } });

        if (!fileRecord) return res.status(404).json({ error: 'File not found' });
        if (fileRecord.user_id !== req.user.id) {
            await log({ event: 'access_denied', userId: req.user.id, fileId, ip: req.ip, detail: 'delete attempt' });
            return res.status(403).json({ error: 'Access denied' });
        }

        if (fs.existsSync(fileRecord.encrypted_file_path)) {
            fs.unlinkSync(fileRecord.encrypted_file_path);
        }

        await prisma.shareLink.deleteMany({ where: { file_id: fileId } });
        await prisma.file.delete({ where: { id: fileId } });

        res.json({ message: 'File deleted successfully' });
    } catch (error) {
        console.error('[files/delete]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;

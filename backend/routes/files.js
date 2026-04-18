const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const File    = require('../models/File');
const ShareLink = require('../models/ShareLink');
const authenticateToken = require('../middleware/auth');
const { log } = require('../logger');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// ─── Multer (single-shot upload) ─────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename:    (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`),
});

const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

// ─── POST /files/upload ───────────────────────────────────────────────────────
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const { iv } = req.body;
        if (!iv) return res.status(400).json({ error: 'Initialization vector (iv) is required' });

        const fileBuffer = fs.readFileSync(req.file.path);
        const fileHash   = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        const fileRecord = await File.create({
            user_id:             req.user.id,
            filename:            req.file.originalname,
            encrypted_file_path: req.file.path,
            iv,
            file_hash:   fileHash,
            file_size:   fileBuffer.length,
            chunk_count: 1,
        });

        await log({ event: 'upload', userId: req.user.id, fileId: fileRecord.id, detail: `size=${fileBuffer.length} hash=${fileHash.slice(0, 12)}...`, ip: req.ip });

        res.status(201).json({ message: 'File uploaded successfully', file: fileRecord });
    } catch (error) {
        console.error('[files/upload]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /files ───────────────────────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
    try {
        const files = await File.find({ user_id: req.user.id })
            .sort({ created_at: -1 })
            .select('id filename file_hash file_size chunk_count created_at');
        res.json(files);
    } catch (error) {
        console.error('[files/list]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── DELETE /files/:id ────────────────────────────────────────────────────────
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const fileRecord = await File.findById(req.params.id);
        if (!fileRecord) return res.status(404).json({ error: 'File not found' });

        if (fileRecord.user_id.toString() !== req.user.id.toString()) {
            await log({ event: 'access_denied', userId: req.user.id, fileId: req.params.id, ip: req.ip, detail: 'delete attempt' });
            return res.status(403).json({ error: 'Access denied' });
        }

        if (fs.existsSync(fileRecord.encrypted_file_path)) {
            fs.unlinkSync(fileRecord.encrypted_file_path);
        }

        await ShareLink.deleteMany({ file_id: req.params.id });
        await File.findByIdAndDelete(req.params.id);

        res.json({ message: 'File deleted successfully' });
    } catch (error) {
        console.error('[files/delete]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;

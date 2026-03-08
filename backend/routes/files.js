const express = require('express');
const router = express.Router();
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const authenticateToken = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// Configure multer with an absolute destination path
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        // Safe unique filename
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { iv } = req.body;
        if (!iv) {
            return res.status(400).json({ error: 'Initialization vector (iv) is required for decryption' });
        }

        const fileRecord = await prisma.file.create({
            data: {
                user_id: req.user.id,
                filename: req.file.originalname,
                encrypted_file_path: req.file.path,
                iv: iv,
            }
        });

        res.status(201).json({ message: 'File uploaded successfully', file: fileRecord });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/', authenticateToken, async (req, res) => {
    try {
        const files = await prisma.file.findMany({
            where: { user_id: req.user.id },
            orderBy: { created_at: 'desc' }
        });
        res.json(files);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const fileId = req.params.id;

        const fileRecord = await prisma.file.findUnique({ where: { id: fileId } });
        if (!fileRecord) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (fileRecord.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Delete from file system
        if (fs.existsSync(fileRecord.encrypted_file_path)) {
            fs.unlinkSync(fileRecord.encrypted_file_path);
        }

        // Delete database record (share links deleted by cascading maybe? Prisma needs explicit if not enabled)
        await prisma.shareLink.deleteMany({ where: { file_id: fileId } });
        await prisma.file.delete({ where: { id: fileId } });

        res.json({ message: 'File deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;

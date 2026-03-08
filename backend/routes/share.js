const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const authenticateToken = require('../middleware/auth');

const prisma = new PrismaClient();

router.post('/create', authenticateToken, async (req, res) => {
    try {
        const { file_id, expiry_hours, download_limit } = req.body;
        
        if (!file_id || !expiry_hours || !download_limit) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const file = await prisma.file.findUnique({ where: { id: file_id } });
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (file.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiry_time = new Date(Date.now() + expiry_hours * 60 * 60 * 1000);

        const shareLink = await prisma.shareLink.create({
            data: {
                token,
                file_id,
                expiry_time,
                download_limit: parseInt(download_limit),
                download_count: 0
            }
        });

        res.status(201).json({ 
            message: 'Share link created successfully',
            token: shareLink.token,
            expiry_time: shareLink.expiry_time,
            download_limit: shareLink.download_limit 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/download/:token', async (req, res) => {
    try {
        const { token } = req.params;

        const shareLink = await prisma.shareLink.findUnique({ 
            where: { token },
            include: { file: true }
        });

        if (!shareLink) {
            return res.status(404).json({ error: 'Invalid or missing link token' });
        }

        if (new Date() > shareLink.expiry_time) {
            return res.status(410).json({ error: 'Link has expired' });
        }

        if (shareLink.download_count >= shareLink.download_limit) {
            return res.status(410).json({ error: 'Download limit exceeded' });
        }

        const fileRecord = shareLink.file;

        // Always use absolute path to avoid CWD-relative resolution failures
        const absoluteFilePath = path.isAbsolute(fileRecord.encrypted_file_path)
            ? fileRecord.encrypted_file_path
            : path.join(__dirname, '..', fileRecord.encrypted_file_path);

        if (!fs.existsSync(absoluteFilePath)) {
            return res.status(404).json({ error: 'File not found on server' });
        }

        // Increment download count
        await prisma.shareLink.update({
            where: { id: shareLink.id },
            data: { download_count: { increment: 1 } }
        });

        // Set custom headers carrying the decryption metadata.
        // Access-Control-Expose-Headers is set globally in index.js CORS config.
        res.setHeader('X-File-Name', encodeURIComponent(fileRecord.filename));
        res.setHeader('X-File-IV', fileRecord.iv);
        res.setHeader('Content-Disposition', `attachment; filename="${fileRecord.filename}"`);
        res.setHeader('Content-Type', 'application/octet-stream');

        // Stream it — sendFile works well with absolute paths
        res.sendFile(absoluteFilePath);
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;


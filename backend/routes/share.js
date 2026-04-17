const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const authenticateToken = require('../middleware/auth');
const { log } = require('../logger');

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

// ─── POST /share/create ───────────────────────────────────────────────────────
// Create a time-bound, usage-limited share link. Password is optional.
router.post('/create', authenticateToken, async (req, res) => {
    try {
        const { file_id, expiry_hours, download_limit, password } = req.body;

        if (!file_id || !expiry_hours || !download_limit) {
            return res.status(400).json({ error: 'file_id, expiry_hours, download_limit are required' });
        }

        const file = await prisma.file.findUnique({ where: { id: file_id } });
        if (!file) return res.status(404).json({ error: 'File not found' });

        if (file.user_id !== req.user.id) {
            await log({ event: 'access_denied', userId: req.user.id, fileId: file_id, ip: req.ip, detail: 'share create' });
            return res.status(403).json({ error: 'Access denied' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiry_time = new Date(Date.now() + parseFloat(expiry_hours) * 60 * 60 * 1000);

        // Hash password if provided
        let password_hash = null;
        if (password && password.trim() !== '') {
            password_hash = await bcrypt.hash(password.trim(), SALT_ROUNDS);
        }

        const shareLink = await prisma.shareLink.create({
            data: {
                token,
                file_id,
                password_hash,
                expiry_time,
                download_limit: parseInt(download_limit),
                download_count: 0,
            }
        });

        await log({
            event: 'link_created',
            userId: req.user.id,
            fileId: file_id,
            token,
            ip: req.ip,
            detail: `expiry=${expiry_hours}h limit=${download_limit} protected=${!!password_hash}`,
        });

        res.status(201).json({
            message: 'Share link created successfully',
            token: shareLink.token,
            expiry_time: shareLink.expiry_time,
            download_limit: shareLink.download_limit,
            password_protected: !!password_hash,
        });
    } catch (error) {
        console.error('[share/create]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /share/info/:token ───────────────────────────────────────────────────
// Get share link metadata without downloading (used by download page to show UI).
router.get('/info/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const shareLink = await prisma.shareLink.findUnique({
            where: { token },
            include: { file: { select: { filename: true, file_size: true, file_hash: true } } }
        });

        if (!shareLink) return res.status(404).json({ error: 'Invalid or missing link token' });
        if (new Date() > shareLink.expiry_time) return res.status(410).json({ error: 'Link has expired' });
        if (shareLink.download_count >= shareLink.download_limit) {
            return res.status(410).json({ error: 'Download limit exceeded' });
        }

        res.json({
            filename: shareLink.file.filename,
            file_size: shareLink.file.file_size,
            expiry_time: shareLink.expiry_time,
            downloads_remaining: shareLink.download_limit - shareLink.download_count,
            password_protected: !!shareLink.password_hash,
        });
    } catch (error) {
        console.error('[share/info]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── POST /share/download/:token ─────────────────────────────────────────────
// Download the file. Validates JWT (optional), expiry, download limit, password.
// Using POST so the password can be sent in the body (not exposed in URL).
router.post('/download/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.body;

        const shareLink = await prisma.shareLink.findUnique({
            where: { token },
            include: { file: true }
        });

        if (!shareLink) {
            await log({ event: 'access_denied', token, ip: req.ip, detail: 'invalid token' });
            return res.status(404).json({ error: 'Invalid or missing link token' });
        }

        if (new Date() > shareLink.expiry_time) {
            await log({ event: 'access_denied', token, ip: req.ip, detail: 'expired' });
            return res.status(410).json({ error: 'Link has expired' });
        }

        if (shareLink.download_count >= shareLink.download_limit) {
            await log({ event: 'access_denied', token, ip: req.ip, detail: 'limit exceeded' });
            return res.status(410).json({ error: 'Download limit exceeded' });
        }

        // Password check
        if (shareLink.password_hash) {
            if (!password) {
                return res.status(401).json({ error: 'Password required', password_required: true });
            }
            const valid = await bcrypt.compare(password, shareLink.password_hash);
            if (!valid) {
                await log({ event: 'auth_fail', token, ip: req.ip, detail: 'wrong password' });
                return res.status(401).json({ error: 'Incorrect password' });
            }
        }

        const fileRecord = shareLink.file;
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

        await log({
            event: 'download',
            fileId: fileRecord.id,
            token,
            ip: req.ip,
            detail: `count=${shareLink.download_count + 1}/${shareLink.download_limit}`,
        });

        // Set decryption + integrity headers
        res.setHeader('X-File-Name', encodeURIComponent(fileRecord.filename));
        res.setHeader('X-File-IV', fileRecord.iv);
        res.setHeader('X-File-Hash', fileRecord.file_hash);   // SHA-256 for integrity check
        res.setHeader('X-File-Size', fileRecord.file_size.toString());
        res.setHeader('Content-Disposition', `attachment; filename="${fileRecord.filename}"`);
        res.setHeader('Content-Type', 'application/octet-stream');

        res.sendFile(absoluteFilePath);

    } catch (error) {
        console.error('[share/download]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Keep GET for backward compat (no password support)
router.get('/download/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const shareLink = await prisma.shareLink.findUnique({
            where: { token },
            include: { file: true }
        });

        if (!shareLink) return res.status(404).json({ error: 'Invalid or missing link token' });
        if (new Date() > shareLink.expiry_time) return res.status(410).json({ error: 'Link has expired' });
        if (shareLink.download_count >= shareLink.download_limit) return res.status(410).json({ error: 'Download limit exceeded' });

        if (shareLink.password_hash) {
            return res.status(401).json({ error: 'This link requires a password. Use the download page.', password_required: true });
        }

        const fileRecord = shareLink.file;
        const absoluteFilePath = path.isAbsolute(fileRecord.encrypted_file_path)
            ? fileRecord.encrypted_file_path
            : path.join(__dirname, '..', fileRecord.encrypted_file_path);

        if (!fs.existsSync(absoluteFilePath)) return res.status(404).json({ error: 'File not found on server' });

        await prisma.shareLink.update({ where: { id: shareLink.id }, data: { download_count: { increment: 1 } } });

        await log({ event: 'download', fileId: fileRecord.id, token, ip: req.ip });

        res.setHeader('X-File-Name', encodeURIComponent(fileRecord.filename));
        res.setHeader('X-File-IV', fileRecord.iv);
        res.setHeader('X-File-Hash', fileRecord.file_hash);
        res.setHeader('X-File-Size', fileRecord.file_size.toString());
        res.setHeader('Content-Disposition', `attachment; filename="${fileRecord.filename}"`);
        res.setHeader('Content-Type', 'application/octet-stream');

        res.sendFile(absoluteFilePath);
    } catch (error) {
        console.error('[share/download GET]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;

const express   = require('express');
const router    = express.Router();
const crypto    = require('crypto');
const fs        = require('fs');
const path      = require('path');
const bcrypt    = require('bcrypt');
const File      = require('../models/File');
const ShareLink = require('../models/ShareLink');
const authenticateToken = require('../middleware/auth');
const { log } = require('../logger');

const SALT_ROUNDS = 10;

// ─── POST /share/create ───────────────────────────────────────────────────────
router.post('/create', authenticateToken, async (req, res) => {
    try {
        const { file_id, expiry_hours, download_limit, password } = req.body;

        if (!file_id || !expiry_hours || !download_limit) {
            return res.status(400).json({ error: 'file_id, expiry_hours, download_limit are required' });
        }

        const file = await File.findById(file_id);
        if (!file) return res.status(404).json({ error: 'File not found' });

        if (file.user_id.toString() !== req.user.id.toString()) {
            await log({ event: 'access_denied', userId: req.user.id, fileId: file_id, ip: req.ip, detail: 'share create' });
            return res.status(403).json({ error: 'Access denied' });
        }

        const token       = crypto.randomBytes(32).toString('hex');
        const expiry_time = new Date(Date.now() + parseFloat(expiry_hours) * 3600 * 1000);

        let password_hash = null;
        if (password && password.trim() !== '') {
            password_hash = await bcrypt.hash(password.trim(), SALT_ROUNDS);
        }

        const shareLink = await ShareLink.create({
            token,
            file_id: file.id,
            password_hash,
            expiry_time,
            download_limit: parseInt(download_limit),
            download_count: 0,
        });

        await log({ event: 'link_created', userId: req.user.id, fileId: file_id, token, ip: req.ip, detail: `expiry=${expiry_hours}h limit=${download_limit} protected=${!!password_hash}` });

        res.status(201).json({
            message:           'Share link created successfully',
            token:             shareLink.token,
            expiry_time:       shareLink.expiry_time,
            download_limit:    shareLink.download_limit,
            password_protected: !!password_hash,
        });
    } catch (error) {
        console.error('[share/create]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /share/info/:token ───────────────────────────────────────────────────
router.get('/info/:token', async (req, res) => {
    try {
        const shareLink = await ShareLink.findOne({ token: req.params.token });
        if (!shareLink) return res.status(404).json({ error: 'Invalid or missing link token' });
        if (new Date() > shareLink.expiry_time)                         return res.status(410).json({ error: 'Link has expired' });
        if (shareLink.download_count >= shareLink.download_limit) return res.status(410).json({ error: 'Download limit exceeded' });

        const file = await File.findById(shareLink.file_id).select('filename file_size iv file_hash');
        if (!file) return res.status(404).json({ error: 'File not found' });

        res.json({
            filename:           file.filename,
            file_size:          file.file_size,
            iv:                 file.iv,          // needed for client-side decryption
            file_hash:          file.file_hash,  // needed for integrity check
            expiry_time:        shareLink.expiry_time,
            downloads_remaining: shareLink.download_limit - shareLink.download_count,
            password_protected: !!shareLink.password_hash,
        });
    } catch (error) {
        console.error('[share/info]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── POST /share/download/:token ─────────────────────────────────────────────
router.post('/download/:token', async (req, res) => {
    try {
        const { password } = req.body;

        const shareLink = await ShareLink.findOne({ token: req.params.token });
        if (!shareLink) {
            await log({ event: 'access_denied', token: req.params.token, ip: req.ip, detail: 'invalid token' });
            return res.status(404).json({ error: 'Invalid or missing link token' });
        }
        if (new Date() > shareLink.expiry_time) {
            await log({ event: 'access_denied', token: req.params.token, ip: req.ip, detail: 'expired' });
            return res.status(410).json({ error: 'Link has expired' });
        }
        if (shareLink.download_count >= shareLink.download_limit) {
            await log({ event: 'access_denied', token: req.params.token, ip: req.ip, detail: 'limit exceeded' });
            return res.status(410).json({ error: 'Download limit exceeded' });
        }

        if (shareLink.password_hash) {
            if (!password) return res.status(401).json({ error: 'Password required', password_required: true });
            const valid = await bcrypt.compare(password, shareLink.password_hash);
            if (!valid) {
                await log({ event: 'auth_fail', token: req.params.token, ip: req.ip, detail: 'wrong password' });
                return res.status(401).json({ error: 'Incorrect password' });
            }
        }

        const fileRecord = await File.findById(shareLink.file_id);
        if (!fileRecord) return res.status(404).json({ error: 'File record not found' });

        const absoluteFilePath = path.isAbsolute(fileRecord.encrypted_file_path)
            ? fileRecord.encrypted_file_path
            : path.join(__dirname, '..', fileRecord.encrypted_file_path);

        if (!fs.existsSync(absoluteFilePath)) return res.status(404).json({ error: 'File not found on server' });

        await ShareLink.findByIdAndUpdate(shareLink._id, { $inc: { download_count: 1 } });
        await log({ event: 'download', fileId: fileRecord.id, token: req.params.token, ip: req.ip, detail: `count=${shareLink.download_count + 1}/${shareLink.download_limit}` });

        res.setHeader('X-File-Name', encodeURIComponent(fileRecord.filename));
        res.setHeader('X-File-IV',   fileRecord.iv);
        res.setHeader('X-File-Hash', fileRecord.file_hash);
        res.setHeader('X-File-Size', fileRecord.file_size.toString());
        res.setHeader('Content-Disposition', `attachment; filename="${fileRecord.filename}"`);
        res.setHeader('Content-Type', 'application/octet-stream');

        res.sendFile(absoluteFilePath);
    } catch (error) {
        console.error('[share/download POST]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── GET /share/download/:token (no-password backward compat) ─────────────────
router.get('/download/:token', async (req, res) => {
    try {
        const shareLink = await ShareLink.findOne({ token: req.params.token });
        if (!shareLink) return res.status(404).json({ error: 'Invalid link' });
        if (new Date() > shareLink.expiry_time) return res.status(410).json({ error: 'Link has expired' });
        if (shareLink.download_count >= shareLink.download_limit) return res.status(410).json({ error: 'Download limit exceeded' });
        if (shareLink.password_hash) return res.status(401).json({ error: 'This link requires a password. Use the download page.', password_required: true });

        const fileRecord = await File.findById(shareLink.file_id);
        if (!fileRecord) return res.status(404).json({ error: 'File not found' });

        const absoluteFilePath = path.isAbsolute(fileRecord.encrypted_file_path)
            ? fileRecord.encrypted_file_path
            : path.join(__dirname, '..', fileRecord.encrypted_file_path);

        if (!fs.existsSync(absoluteFilePath)) return res.status(404).json({ error: 'File not found on server' });

        await ShareLink.findByIdAndUpdate(shareLink._id, { $inc: { download_count: 1 } });
        await log({ event: 'download', fileId: fileRecord.id, token: req.params.token, ip: req.ip });

        res.setHeader('X-File-Name', encodeURIComponent(fileRecord.filename));
        res.setHeader('X-File-IV',   fileRecord.iv);
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

const fs = require('fs')
const crypto = require('crypto')
const bcrypt = require('bcrypt')
const File = require('../models/File')
const ShareLink = require('../models/ShareLink')
const { log } = require('../logger')

const SALT_ROUNDS = 10

// ─── POST /share/create ───────────────────────────────────────────────────────
const createShareLink = async (req, res) => {
  try {
    const { file_id, expiry_hours, download_limit, password } = req.body

    if (!file_id || !expiry_hours || !download_limit) {
      return res
        .status(400)
        .json({ error: 'file_id, expiry_hours, download_limit are required' })
    }

    const file = await File.findById(file_id)
    if (!file) return res.status(404).json({ error: 'File not found' })

    if (file.user_id.toString() !== req.user.id.toString()) {
      await log({
        event:  'access_denied',
        userId: req.user.id,
        fileId: file_id,
        ip:     req.ip,
        detail: 'share create',
      })
      return res.status(403).json({ error: 'Access denied' })
    }

    const token = crypto.randomBytes(32).toString('hex')
    const expiry_time = new Date(Date.now() + parseFloat(expiry_hours) * 3600 * 1000)

    let password_hash = null
    if (password && password.trim() !== '') {
      password_hash = await bcrypt.hash(password.trim(), SALT_ROUNDS)
    }

    const shareLink = await ShareLink.create({
      token,
      file_id:        file.id,
      password_hash,
      expiry_time,
      download_limit: parseInt(download_limit),
      download_count: 0,
    })

    await log({
      event:  'link_created',
      userId: req.user.id,
      fileId: file_id,
      token,
      ip:     req.ip,
      detail: `expiry=${expiry_hours}h limit=${download_limit} protected=${!!password_hash}`,
    })

    res.status(201).json({
      message:          'Share link created successfully',
      token:            shareLink.token,
      expiry_time:      shareLink.expiry_time,
      download_limit:   shareLink.download_limit,
      password_protected: !!password_hash,
    })
  } catch (error) {
    console.error('[share/create]', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ─── GET /share/info/:token ───────────────────────────────────────────────────
const getShareInfo = async (req, res) => {
  try {
    const shareLink = await ShareLink.findOne({ token: req.params.token })
    if (!shareLink)
      return res.status(404).json({ error: 'Invalid or missing link token' })
    if (new Date() > shareLink.expiry_time)
      return res.status(410).json({ error: 'Link has expired' })
    if (shareLink.download_count >= shareLink.download_limit)
      return res.status(410).json({ error: 'Download limit exceeded' })

    const file = await File.findById(shareLink.file_id).select(
      'filename file_size iv file_hash'
    )
    if (!file) return res.status(404).json({ error: 'File not found' })

    res.json({
      filename:            file.filename,
      file_size:           file.file_size,
      iv:                  file.iv,        // needed for client-side decryption
      file_hash:           file.file_hash, // needed for integrity check
      expiry_time:         shareLink.expiry_time,
      downloads_remaining: shareLink.download_limit - shareLink.download_count,
      password_protected:  !!shareLink.password_hash,
    })
  } catch (error) {
    console.error('[share/info]', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ─── Shared helper: validate link and optionally verify password ──────────────
async function resolveShareLink(token, password, ip) {
  const shareLink = await ShareLink.findOne({ token })
  if (!shareLink) {
    await log({ event: 'access_denied', token, ip, detail: 'invalid token' })
    return { error: 'Invalid or missing link token', status: 404 }
  }
  if (new Date() > shareLink.expiry_time) {
    await log({ event: 'access_denied', token, ip, detail: 'expired' })
    return { error: 'Link has expired', status: 410 }
  }
  if (shareLink.download_count >= shareLink.download_limit) {
    await log({ event: 'access_denied', token, ip, detail: 'limit exceeded' })
    return { error: 'Download limit exceeded', status: 410 }
  }
  if (shareLink.password_hash) {
    if (!password)
      return { error: 'Password required', status: 401, password_required: true }
    const valid = await bcrypt.compare(password, shareLink.password_hash)
    if (!valid) {
      await log({ event: 'auth_fail', token, ip, detail: 'wrong password' })
      return { error: 'Incorrect password', status: 401 }
    }
  }
  return { shareLink }
}

// ─── Shared helper: stream file buffer from local disk ───────────────────────
async function sendFile(res, fileRecord, shareLink, token, ip) {
  if (!fileRecord.file_path || !fs.existsSync(fileRecord.file_path)) {
    return res.status(404).json({ error: 'File not found in storage' })
  }

  const encryptedBuffer = fs.readFileSync(fileRecord.file_path)

  await ShareLink.findByIdAndUpdate(shareLink._id, { $inc: { download_count: 1 } })
  await log({
    event:  'download',
    fileId: fileRecord.id,
    token,
    ip,
    detail: `count=${shareLink.download_count + 1}/${shareLink.download_limit}`,
  })

  res.setHeader('X-File-Name', encodeURIComponent(fileRecord.filename))
  res.setHeader('X-File-IV', fileRecord.iv)
  res.setHeader('X-File-Hash', fileRecord.file_hash)
  res.setHeader('X-File-Size', fileRecord.file_size.toString())
  res.setHeader('Content-Disposition', `attachment; filename="${fileRecord.filename}"`)
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Length', encryptedBuffer.length)
  res.end(encryptedBuffer)
}

// ─── POST /share/download/:token ──────────────────────────────────────────────
const downloadWithPassword = async (req, res) => {
  try {
    const { password } = req.body
    const result = await resolveShareLink(req.params.token, password, req.ip)

    if (result.error) {
      return res
        .status(result.status)
        .json(result.password_required ? { error: result.error, password_required: true } : { error: result.error })
    }

    const fileRecord = await File.findById(result.shareLink.file_id)
    if (!fileRecord) return res.status(404).json({ error: 'File record not found' })

    await sendFile(res, fileRecord, result.shareLink, req.params.token, req.ip)
  } catch (error) {
    console.error('[share/download POST]', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ─── GET /share/download/:token (no-password backward compat) ─────────────────
const downloadWithoutPassword = async (req, res) => {
  try {
    const shareLink = await ShareLink.findOne({ token: req.params.token })
    if (!shareLink) return res.status(404).json({ error: 'Invalid link' })
    if (new Date() > shareLink.expiry_time)
      return res.status(410).json({ error: 'Link has expired' })
    if (shareLink.download_count >= shareLink.download_limit)
      return res.status(410).json({ error: 'Download limit exceeded' })
    if (shareLink.password_hash)
      return res.status(401).json({
        error: 'This link requires a password. Use the download page.',
        password_required: true,
      })

    const fileRecord = await File.findById(shareLink.file_id)
    if (!fileRecord) return res.status(404).json({ error: 'File not found' })

    await sendFile(res, fileRecord, shareLink, req.params.token, req.ip)
  } catch (error) {
    console.error('[share/download GET]', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

module.exports = {
  createShareLink,
  getShareInfo,
  downloadWithPassword,
  downloadWithoutPassword,
}

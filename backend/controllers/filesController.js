const multer = require('multer')
const crypto = require('crypto')
const File = require('../models/File')
const ShareLink = require('../models/ShareLink')
const { log } = require('../logger')
const {
  uploadFile,
  deleteFile,
  generateObjectKey,
} = require('../services/r2Service')

// ─── Multer (single-shot upload) ──────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
})

// ─── POST /files/upload ───────────────────────────────────────────────────────
const uploadFile_ = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    const { iv } = req.body
    if (!iv)
      return res
        .status(400)
        .json({ error: 'Initialization vector (iv) is required' })

    const fileBuffer = req.file.buffer
    const fileHash = crypto
      .createHash('sha256')
      .update(fileBuffer)
      .digest('hex')
    const objectKey = generateObjectKey(req.file.originalname)
    const uploadResult = await uploadFile(fileBuffer, objectKey)

    const fileRecord = await File.create({
      user_id: req.user.id,
      filename: req.file.originalname,
      encrypted_file_path: '',
      objectKey: uploadResult.objectKey,
      bucket: uploadResult.bucket,
      storageProvider: 'cloudflare-r2',
      mimeType: req.file.mimetype || 'application/octet-stream',
      size: fileBuffer.length,
      etag: uploadResult.etag,
      iv,
      file_hash: fileHash,
      file_size: fileBuffer.length,
      chunk_count: 1,
    })

    await log({
      event: 'upload',
      userId: req.user.id,
      fileId: fileRecord.id,
      detail: `size=${fileBuffer.length} hash=${fileHash.slice(0, 12)}...`,
      ip: req.ip,
    })

    res
      .status(201)
      .json({ message: 'File uploaded successfully', file: fileRecord })
  } catch (error) {
    console.error('[files/upload]', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ─── GET /files ───────────────────────────────────────────────────────────────
const listFiles = async (req, res) => {
  try {
    const files = await File.find({ user_id: req.user.id })
      .sort({ created_at: -1 })
      .select('id filename file_hash file_size chunk_count created_at')

    // Fetch associated share links for these files
    const fileIds = files.map((f) => f.id)
    const shareLinks = await ShareLink.find({ file_id: { $in: fileIds } })

    // Group share links by file_id
    const linksByFile = {}
    shareLinks.forEach((link) => {
      if (!linksByFile[link.file_id]) {
        linksByFile[link.file_id] = []
      }
      linksByFile[link.file_id].push({
        token: link.token,
        expiry_time: link.expiry_time,
        download_limit: link.download_limit,
        download_count: link.download_count,
        created_at: link.created_at,
      })
    })

    // Attach links to files response
    const filesWithLinks = files.map((file) => {
      const fileObj = file.toJSON()
      fileObj.share_links = linksByFile[file.id] || []
      return fileObj
    })

    res.json(filesWithLinks)
  } catch (error) {
    console.error('[files/list]', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ─── DELETE /files/:id ────────────────────────────────────────────────────────
const deleteFileById = async (req, res) => {
  try {
    const fileRecord = await File.findById(req.params.id)
    if (!fileRecord) return res.status(404).json({ error: 'File not found' })

    if (fileRecord.user_id.toString() !== req.user.id.toString()) {
      await log({
        event: 'access_denied',
        userId: req.user.id,
        fileId: req.params.id,
        ip: req.ip,
        detail: 'delete attempt',
      })
      return res.status(403).json({ error: 'Access denied' })
    }

    if (fileRecord.objectKey) {
      try {
        await deleteFile(fileRecord.objectKey)
      } catch (error) {
        console.error('[files/delete][r2]', error)
        await log({
          event: 'delete_failed',
          userId: req.user.id,
          fileId: req.params.id,
          ip: req.ip,
          detail: 'r2 delete failed',
        })
        return res
          .status(500)
          .json({ error: 'Failed to delete file from storage' })
      }
    }

    await ShareLink.deleteMany({ file_id: req.params.id })
    await File.findByIdAndDelete(req.params.id)

    res.json({ message: 'File deleted successfully' })
  } catch (error) {
    console.error('[files/delete]', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

module.exports = { upload, uploadFile_, listFiles, deleteFileById }

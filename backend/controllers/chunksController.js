const path = require('path')
const fs = require('fs')
const multer = require('multer')
const crypto = require('crypto')
const File = require('../models/File')
const { log } = require('../logger')

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads')
const chunkStore = {}

// ─── Multer: chunk storage in memory ─────────────────────────────────────────
const chunkUpload = multer({ storage: multer.memoryStorage() })

// ─── POST /chunks/upload ──────────────────────────────────────────────────────
const uploadChunk = async (req, res) => {
  try {
    const { sessionId, chunkIndex, totalChunks } = req.body

    if (!req.file) return res.status(400).json({ error: 'No chunk data' })
    if (!sessionId || chunkIndex === undefined || !totalChunks) {
      return res
        .status(400)
        .json({ error: 'sessionId, chunkIndex, totalChunks are required' })
    }

    if (!chunkStore[sessionId]) chunkStore[sessionId] = []
    chunkStore[sessionId][parseInt(chunkIndex)] = req.file.buffer

    await log({
      event:  'chunk_upload',
      userId: req.user.id,
      detail: `session=${sessionId} chunk=${chunkIndex}/${totalChunks}`,
      ip:     req.ip,
    })

    res.json({
      message:    'Chunk received',
      chunkIndex: parseInt(chunkIndex),
      sessionId,
    })
  } catch (err) {
    console.error('[chunks/upload]', err)
    res.status(500).json({ error: 'Failed to store chunk' })
  }
}

// ─── POST /chunks/finalize ────────────────────────────────────────────────────
const finalizeChunks = async (req, res) => {
  const { sessionId, totalChunks, filename, iv } = req.body

  if (!sessionId || !totalChunks || !filename || !iv) {
    return res
      .status(400)
      .json({ error: 'sessionId, totalChunks, filename, iv are required' })
  }

  try {
    const sessionChunks = chunkStore[sessionId]
    const missing = []
    const buffers = []

    for (let i = 0; i < parseInt(totalChunks); i++) {
      const chunkBuffer = sessionChunks?.[i]
      if (!Buffer.isBuffer(chunkBuffer)) {
        missing.push(i)
      } else {
        buffers.push(chunkBuffer)
      }
    }

    if (missing.length > 0) {
      return res
        .status(400)
        .json({ error: `Missing chunks: ${missing.join(', ')}` })
    }

    const fileBuffer = Buffer.concat(buffers)
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')

    // Save assembled file to local disk
    const storedFilename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`
    const filePath = path.join(UPLOADS_DIR, storedFilename)
    fs.writeFileSync(filePath, fileBuffer)

    const fileRecord = await File.create({
      user_id:     req.user.id,
      filename,
      file_path:   filePath,
      mimeType:    'application/octet-stream',
      iv,
      file_hash:   fileHash,
      file_size:   fileBuffer.length,
      chunk_count: parseInt(totalChunks),
    })

    delete chunkStore[sessionId]

    await log({
      event:  'upload',
      userId: req.user.id,
      fileId: fileRecord.id,
      detail: `chunks=${totalChunks} size=${fileBuffer.length} hash=${fileHash.slice(0, 12)}...`,
      ip:     req.ip,
    })

    res.status(201).json({ message: 'File assembled successfully', file: fileRecord })
  } catch (err) {
    console.error('[chunks/finalize]', err)
    res.status(500).json({ error: 'Failed to finalize chunked upload' })
  }
}

module.exports = { chunkUpload, uploadChunk, finalizeChunks }

const express = require('express')
const router = express.Router()
const authenticateToken = require('../middleware/auth')
const {
  chunkUpload,
  uploadChunk,
  finalizeChunks,
} = require('../controllers/chunksController')

// ─── POST /chunks/upload ──────────────────────────────────────────────────────
router.post('/upload', authenticateToken, chunkUpload.single('chunk'), uploadChunk)

// ─── POST /chunks/finalize ────────────────────────────────────────────────────
router.post('/finalize', authenticateToken, finalizeChunks)

module.exports = router

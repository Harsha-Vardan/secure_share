const express = require('express')
const router = express.Router()
const authenticateToken = require('../middleware/auth')
const {
  upload,
  uploadFile_,
  listFiles,
  deleteFileById,
} = require('../controllers/filesController')

// ─── POST /files/upload ───────────────────────────────────────────────────────
router.post('/upload', authenticateToken, upload.single('file'), uploadFile_)

// ─── GET /files ───────────────────────────────────────────────────────────────
router.get('/', authenticateToken, listFiles)

// ─── DELETE /files/:id ────────────────────────────────────────────────────────
router.delete('/:id', authenticateToken, deleteFileById)

module.exports = router

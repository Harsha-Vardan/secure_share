const express = require('express')
const router = express.Router()
const authenticateToken = require('../middleware/auth')
const {
  createShareLink,
  getShareInfo,
  downloadWithPassword,
  downloadWithoutPassword,
} = require('../controllers/shareController')

// ─── POST /share/create ───────────────────────────────────────────────────────
router.post('/create', authenticateToken, createShareLink)

// ─── GET /share/info/:token ───────────────────────────────────────────────────
router.get('/info/:token', getShareInfo)

// ─── POST /share/download/:token ──────────────────────────────────────────────
router.post('/download/:token', downloadWithPassword)

// ─── GET /share/download/:token (no-password backward compat) ─────────────────
router.get('/download/:token', downloadWithoutPassword)

module.exports = router

const fs   = require('fs');
const path = require('path');

const LOG_DIR  = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'activity.log');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

/**
 * Log an activity event to flat file + MongoDB (non-blocking).
 * @param {Object} opts
 * @param {'upload'|'download'|'auth_fail'|'access_denied'|'link_created'|'chunk_upload'|'integrity_fail'} opts.event
 */
async function log({ event, userId, fileId, token, ip, detail }) {
    const entry = {
        ts:     new Date().toISOString(),
        event,
        userId: userId || null,
        fileId: fileId || null,
        token:  token  || null,
        ip:     ip     || null,
        detail: detail || null,
    };

    // Flat JSON log (synchronous — always succeeds even if DB is down)
    try {
        fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
    } catch { /* ignore FS errors */ }

    // DB log — import lazily so this file loads before DB connection
    try {
        const ActivityLog = require('./models/ActivityLog');
        ActivityLog.create({
            event,
            user_id: userId || null,
            file_id: fileId || null,
            token:   token  || null,
            ip:      ip     || null,
            detail:  detail || null,
        }).catch(err => console.error('[Logger] DB write failed:', err.message));
    } catch { /* ignore if model not ready */ }
}

module.exports = { log };

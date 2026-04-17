const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'activity.log');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const prisma = new PrismaClient();

/**
 * Log an activity event to both file and database.
 * @param {Object} opts
 * @param {'upload'|'download'|'auth_fail'|'access_denied'|'link_created'|'chunk_upload'|'integrity_fail'} opts.event
 * @param {string} [opts.userId]
 * @param {string} [opts.fileId]
 * @param {string} [opts.token]
 * @param {string} [opts.ip]
 * @param {string} [opts.detail]
 */
async function log({ event, userId, fileId, token, ip, detail }) {
    const entry = {
        ts: new Date().toISOString(),
        event,
        userId: userId || null,
        fileId: fileId || null,
        token: token || null,
        ip: ip || null,
        detail: detail || null,
    };

    // Append to flat log file (one JSON per line)
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(LOG_FILE, line, 'utf8');

    // Persist to database (non-blocking — don't await in hot paths)
    prisma.activityLog.create({
        data: {
            event,
            user_id: userId || null,
            file_id: fileId || null,
            token: token || null,
            ip: ip || null,
            detail: detail || null,
        }
    }).catch(err => console.error('[Logger] DB write failed:', err.message));
}

module.exports = { log };

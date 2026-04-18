const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    event:      { type: String, required: true },   // upload | download | auth_fail | access_denied | link_created | chunk_upload | integrity_fail
    user_id:    { type: String, default: null },
    file_id:    { type: String, default: null },
    token:      { type: String, default: null },
    ip:         { type: String, default: null },
    detail:     { type: String, default: null },
    created_at: { type: Date, default: Date.now, index: true },
});

activityLogSchema.set('toJSON', {
    virtuals: true,
    transform: (_, ret) => { delete ret._id; delete ret.__v; return ret; }
});

module.exports = mongoose.model('ActivityLog', activityLogSchema);

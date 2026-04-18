const mongoose = require('mongoose');

const shareLinkSchema = new mongoose.Schema({
    token:          { type: String, required: true, unique: true, index: true },
    file_id:        { type: String, required: true },          // File _id as string
    password_hash:  { type: String, default: null },           // bcrypt hash if password-protected
    expiry_time:    { type: Date, required: true },
    download_limit: { type: Number, required: true },
    download_count: { type: Number, default: 0 },
    created_at:     { type: Date, default: Date.now },
});

shareLinkSchema.set('toJSON', {
    virtuals: true,
    transform: (_, ret) => { delete ret._id; delete ret.__v; return ret; }
});

module.exports = mongoose.model('ShareLink', shareLinkSchema);

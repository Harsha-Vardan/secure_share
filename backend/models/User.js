const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username:      { type: String, required: true, unique: true, trim: true },
    email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true },
    created_at:    { type: Date, default: Date.now },
});

// Expose _id as id string in JSON responses
userSchema.set('toJSON', {
    virtuals: true,
    transform: (_, ret) => { delete ret._id; delete ret.__v; return ret; }
});

module.exports = mongoose.model('User', userSchema);

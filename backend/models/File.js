const mongoose = require('mongoose')

const fileSchema = new mongoose.Schema({
  user_id: { type: String, required: true, index: true },
  filename: { type: String, required: true },
  encrypted_file_path: { type: String, default: '' },
  objectKey: { type: String, default: '' },
  bucket: { type: String, default: '' },
  storageProvider: { type: String, default: 'cloudflare-r2' },
  mimeType: { type: String, default: 'application/octet-stream' },
  size: { type: Number, default: 0 },
  etag: { type: String, default: '' },
  iv: { type: String, required: true }, // AES-GCM Initialization Vector (base64)
  file_hash: { type: String, required: true }, // SHA-256 of encrypted blob
  file_size: { type: Number, default: 0 }, // bytes
  chunk_count: { type: Number, default: 1 },
  created_at: { type: Date, default: Date.now },
})

fileSchema.set('toJSON', {
  virtuals: true,
  transform: (_, ret) => {
    delete ret._id
    delete ret.__v
    return ret
  },
})

module.exports = mongoose.model('File', fileSchema)

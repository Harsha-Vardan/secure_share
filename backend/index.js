const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// Ensure upload directory exists (absolute path to avoid CWD issues)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure CORS — must expose custom decryption headers for the browser
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    exposedHeaders: ['X-File-Name', 'X-File-IV'],
}));
app.use(express.json());

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/files', require('./routes/files'));
app.use('/share', require('./routes/share'));

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

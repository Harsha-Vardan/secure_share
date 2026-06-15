const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');

const SALT_ROUNDS = 10;

// ─── POST /auth/register ──────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Username, email and password are required' });
        }

        const existingEmail = await User.findOne({ email: email.toLowerCase().trim() });
        if (existingEmail) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        const existingUsername = await User.findOne({ username: username.trim() });
        if (existingUsername) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        const user = await User.create({ username: username.trim(), email, password_hash });

        res.status(201).json({ message: 'User created successfully', userId: user.id });
    } catch (error) {
        console.error('[auth/register]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ token, userId: user.id, email: user.email, username: user.username });
    } catch (error) {
        console.error('[auth/login]', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;

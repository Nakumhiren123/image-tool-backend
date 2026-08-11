const express = require('express');
const router = express.Router();
const { register, login, googleAuth, logout, me } = require('../controllers/authController');

// Auth Endpoints
router.post('/register', register);
router.post('/login', login);
router.post('/google', googleAuth);
router.post('/logout', logout);
router.get('/me', me);

module.exports = router;

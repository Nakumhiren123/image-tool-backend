const express = require('express');
const router = express.Router();

const {
    register,
    login,
    googleAuth,
    logout,
    me,
    deleteAccount,
    setPassword
} = require('../controllers/authController');

const { authenticate } = require('../middleware/auth');

const {
    issueCsrfToken,
    csrfProtection
} = require('../middleware/csrfProtection');

const { loginProtection } = require('../middleware/loginProtection');

// Auth Endpoints
router.post('/register', csrfProtection, register);

router.post(
    '/login',
    loginProtection,
    csrfProtection,
    login
);

router.post('/google', csrfProtection, googleAuth);

router.get('/csrf', issueCsrfToken);

router.post('/logout', csrfProtection, logout);

router.get('/me', me);

router.post(
    '/set-password',
    authenticate,
    csrfProtection,
    setPassword
);

router.delete(
    '/account',
    authenticate,
    csrfProtection,
    deleteAccount
);

module.exports = router;
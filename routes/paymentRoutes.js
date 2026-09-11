const express = require('express');
const router = express.Router();

const {
    getConfig,
    createOrder,
    verifyPayment,
    verifyRedirect
} = require('../controllers/paymentController');

const { authenticate } = require('../middleware/auth');

const {
    csrfProtection
} = require('../middleware/csrfProtection');

// Public — returns Razorpay Key ID
router.get('/config', getConfig);

// Protected — require valid session cookie
router.post('/create-order', authenticate, csrfProtection, createOrder);
router.post('/verify', authenticate, csrfProtection, verifyPayment);

// Razorpay Hosted Gateway redirect — no cookie
router.post('/verify-redirect', verifyRedirect);

module.exports = router;
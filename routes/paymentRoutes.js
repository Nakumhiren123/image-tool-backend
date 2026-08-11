const express = require('express');
const router = express.Router();
const { createOrder, verifyPayment, verifyRedirect } = require('../controllers/paymentController');

// POST /api/payment/create-order  — create a Razorpay order
router.post('/create-order', createOrder);

// POST /api/payment/verify  — verify signature & upgrade user to PRO
router.post('/verify', verifyPayment);

// POST /api/payment/verify-redirect — handle full-page gateway redirect callback
router.post('/verify-redirect', verifyRedirect);

module.exports = router;

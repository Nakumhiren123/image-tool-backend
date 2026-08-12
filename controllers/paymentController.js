const Razorpay = require('razorpay');
const crypto = require('crypto');
const { query } = require('../db/pool');
const { JWT_SECRET } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Product catalogue — keeps pricing server-side so client cannot tamper with amounts.
 */
const PRODUCTS = {
  monthly: {
    id: 'monthly',
    name: 'PicCraft Pro Monthly',
    amountInr: 39900,  // ₹399 in paise for Razorpay
    amountUsd: 599,    // $5.99 in cents
    currency: 'INR',
    days: 30,
  },
  yearly: {
    id: 'yearly',
    name: 'PicCraft Pro Yearly',
    amountInr: 438900, // ₹4,389 in paise for Razorpay (1 Month Free)
    amountUsd: 6499,   // $64.99 in cents
    currency: 'INR',
    days: 365,
  },
};

/**
 * POST /api/payment/create-order
 * Creates a Razorpay order for Monthly or Yearly plan and returns order_id to frontend.
 */
async function createOrder(req, res) {
  try {
    const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, error: 'You must be logged in to subscribe.' });
    }
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
    }

    // Support both 'plan' and 'productId' field names from client
    const planId = req.body.plan || req.body.productId || 'monthly';
    const product = PRODUCTS[planId];
    if (!product) {
      return res.status(400).json({ success: false, error: 'Invalid subscription plan.' });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret || keyId.includes('REPLACE_WITH_YOUR_KEY') || keySecret.includes('REPLACE_WITH_YOUR_KEY')) {
      return res.json({
        success: false,
        error: '⚠️ Razorpay API keys not configured. Please add your real RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env',
      });
    }

    // Create Razorpay order (receipt MUST be <= 40 characters)
    const receiptId = `rcpt_${Date.now().toString().slice(-10)}_${Math.floor(Math.random() * 1000)}`;

    const order = await razorpay.orders.create({
      amount: product.amountInr,
      currency: product.currency,
      receipt: receiptId,
      notes: {
        userId: String(decoded.id),
        plan: planId,
        productName: product.name,
      },
    });

    return res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      productName: product.name,
      plan: planId,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('Create Order Error:', err?.error?.description || err?.message || err);
    const detailMsg = err?.error?.description || err?.message || 'Could not create subscription order. Please check Razorpay API keys.';
    return res.status(500).json({ success: false, error: detailMsg });
  }
}

/**
 * POST /api/payment/verify
 * Verifies Razorpay payment signature and sets manual subscription period (30 or 365 days).
 */
async function verifyPayment(req, res) {
  try {
    const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, error: 'You must be logged in.' });
    }
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, error: 'Session expired.' });
    }

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      plan,
      productId,
    } = req.body;

    const planId = plan || productId || 'monthly';
    const product = PRODUCTS[planId] || PRODUCTS.monthly;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Missing payment verification fields.' });
    }

    // Verify HMAC-SHA256 signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.warn('Payment signature mismatch for user:', decoded.id);
      return res.status(400).json({ success: false, error: 'Payment verification failed. Signature mismatch.' });
    }

    // Calculate subscription expiry (30 days for monthly, 365 days for yearly)
    const daysToAdd = product.days || 30;
    const expiresAt = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);

    // Update database
    await query(
      `UPDATE users
          SET is_pro = true,
              is_ad_free = true,
              plan = $1,
              subscription_status = 'active',
              expires_at = $2,
              pro_plan = $3,
              pro_purchased_at = NOW(),
              razorpay_order_id = $4,
              razorpay_payment_id = $5
        WHERE id = $6`,
      [planId, expiresAt.toISOString(), product.name, razorpay_order_id, razorpay_payment_id, decoded.id]
    );

    return res.json({
      success: true,
      plan: planId,
      expiresAt: expiresAt.toISOString(),
      message: `🎉 Welcome to PicCraft Pro! Your ${product.name} is active until ${expiresAt.toLocaleDateString()}.`,
    });
  } catch (err) {
    console.error('Verify Payment Error:', err);
    return res.status(500).json({ success: false, error: 'Payment verification error. Contact support.' });
  }
}

/**
 * POST /api/payment/verify-redirect
 * Handles full-page Razorpay Hosted Gateway callback redirect.
 * Verifies signature, updates user DB, and redirects browser back to frontend.
 */
async function verifyRedirect(req, res) {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    const frontendUrl = process.env.FRONTEND_URL || req.headers.origin || 'http://localhost:5173';

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.redirect(`${frontendUrl}?payment=error&message=Missing+payment+fields`);
    }

    // Verify HMAC-SHA256 signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.warn('Redirect payment signature mismatch for order:', razorpay_order_id);
      return res.redirect(`${frontendUrl}?payment=failed&message=Signature+mismatch`);
    }

    // Fetch order details from Razorpay to retrieve notes (userId & plan)
    let planId = 'monthly';
    let userId = null;

    try {
      const orderDetails = await razorpay.orders.fetch(razorpay_order_id);
      if (orderDetails && orderDetails.notes) {
        planId = orderDetails.notes.plan || 'monthly';
        userId = orderDetails.notes.userId;
      }
    } catch (e) {
      console.warn('Could not fetch order notes from Razorpay:', e.message);
    }

    const product = PRODUCTS[planId] || PRODUCTS.monthly;
    const daysToAdd = product.days || 30;
    const expiresAt = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);

    if (userId) {
      await query(
        `UPDATE users
            SET is_pro = true,
                is_ad_free = true,
                plan = $1,
                subscription_status = 'active',
                expires_at = $2,
                pro_plan = $3,
                pro_purchased_at = NOW(),
                razorpay_order_id = $4,
                razorpay_payment_id = $5
          WHERE id = $6`,
        [planId, expiresAt.toISOString(), product.name, razorpay_order_id, razorpay_payment_id, userId]
      );
    }

    return res.redirect(`${frontendUrl}?payment=success&plan=${planId}`);
  } catch (err) {
    console.error('Verify Redirect Error:', err);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}?payment=error`);
  }
}

module.exports = { createOrder, verifyPayment, verifyRedirect };

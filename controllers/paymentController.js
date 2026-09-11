const Razorpay = require('razorpay');
const crypto = require('crypto');
const { pool, query } = require('../db/pool');
const { withTransaction } = require('../db/transaction');
const { JWT_SECRET } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

const logger = require('../utils/logger');

// ── Razorpay instance ─────────────────────────────────────────────────────────
// Instantiated lazily so missing keys give a clear error at call time, not startup.
let razorpayInstance = null;

function getRazorpay() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (
    !keyId || !keySecret ||
    keyId.includes('REPLACE_WITH') ||
    keySecret.includes('REPLACE_WITH')
  ) {
    return null;
  }

  if (!razorpayInstance) {
    razorpayInstance = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return razorpayInstance;
}

// ── Product catalogue — pricing kept server-side ──────────────────────────────
const PRODUCTS = {
  monthly: {
    id: 'monthly',
    name: 'PicCraft Pro Monthly',
    amountInr: 39900,   // ₹399 in paise
    currency: 'INR',
    days: 30,
  },
  yearly: {
    id: 'yearly',
    name: 'PicCraft Pro Yearly',
    amountInr: 438900,  // ₹4,389 in paise (1 month free)
    currency: 'INR',
    days: 365,
  },
};

const ALLOWED_CREATE_ORDER_FIELDS = new Set([
  'plan',
]);

const ALLOWED_VERIFY_FIELDS = new Set([
  'razorpay_order_id',
  'razorpay_payment_id',
  'razorpay_signature',
]);

function hasOnlyAllowedFields(body, allowedFields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }

  return Object.keys(body).every((key) => allowedFields.has(key));
}

// ── Helper: decode cookie JWT ──────────────────────────────────────────────────
function decodeToken(req, res) {
  const token = req.cookies?.token;
  if (!token) {
    res.status(401).json({ success: false, error: 'You must be logged in to subscribe.' });
    return null;
  }
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
    return null;
  }
}

// ── GET /api/payment/config ───────────────────────────────────────────────────
// Returns the Razorpay Key ID (public) so the frontend never needs to hardcode it.
function getConfig(req, res) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId || keyId.includes('REPLACE_WITH')) {
    return res.json({ success: false, configured: false });
  }
  return res.json({ success: true, configured: true, keyId });
}

// ── POST /api/payment/create-order ───────────────────────────────────────────
async function createOrder(req, res) {
  const decoded = decodeToken(req, res);
  if (!decoded) return;

  if (!hasOnlyAllowedFields(req.body, ALLOWED_CREATE_ORDER_FIELDS)) {
    return res.status(400).json({
      success: false,
      error: 'Unexpected request fields.',
    });
  }

  const planId =
    typeof req.body.plan === 'string'
      ? req.body.plan.trim().toLowerCase()
      : 'monthly';

  const product = PRODUCTS[planId];
  if (!product) {
    return res.status(400).json({ success: false, error: 'Invalid subscription plan.' });
  }

  const rzp = getRazorpay();
  if (!rzp) {
    return res.status(503).json({
      success: false,
      error: 'Payment gateway not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to backend/.env',
    });
  }

  try {
    // receipt must be ≤ 40 chars
    const receipt = `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const order = await rzp.orders.create({
      amount: product.amountInr,
      currency: product.currency,
      receipt,
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
      // keyId served here so frontend doesn't need to hardcode it
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    logger.error('Payment order creation failed', {
      requestId: req.requestId,
      errorCategory: 'PAYMENT',
      error: err,
    });

    return res.status(500).json({
      success: false,
      error: 'Unable to create payment order.',
    });
  }
}

// ── POST /api/payment/verify ──────────────────────────────────────────────────
async function verifyPayment(req, res) {
  const decoded = decodeToken(req, res);
  if (!decoded) return;

  if (!hasOnlyAllowedFields(req.body, ALLOWED_VERIFY_FIELDS)) {
    return res.status(400).json({
      success: false,
      error: 'Unexpected request fields.',
    });
  }

  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  } = req.body;

  if (
    typeof razorpay_order_id !== 'string' ||
    typeof razorpay_payment_id !== 'string' ||
    typeof razorpay_signature !== 'string' ||
    !razorpay_order_id.trim() ||
    !razorpay_payment_id.trim() ||
    !razorpay_signature.trim()
  ) {
    return res.status(400).json({
      success: false,
      error: 'Invalid payment verification fields.',
    });
  }

  if (!/^[a-fA-F0-9]{64}$/.test(razorpay_signature.trim())) {
    return res.status(400).json({
      success: false,
      error: 'Invalid payment signature.',
    });
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keySecret || keySecret.includes('REPLACE_WITH')) {
    return res.status(503).json({
      success: false,
      error: 'Payment gateway secret not configured.',
    });
  }

  // 1. Fetch the order directly from Razorpay
  const rzp = getRazorpay();

  if (!rzp) {
    return res.status(503).json({
      success: false,
      error: 'Payment gateway not configured.',
    });
  }

  let orderDetails;

  try {
    orderDetails = await rzp.orders.fetch(razorpay_order_id);
  } catch (err) {
    logger.error('Razorpay order fetch failed', {
      requestId: req.requestId,
      errorCategory: 'PAYMENT',
      error: err,
    });

    return res.status(400).json({
      success: false,
      error: 'Unable to verify payment order.',
    });
  }

  if (!orderDetails || !orderDetails.id) {
    return res.status(400).json({
      success: false,
      error: 'Invalid payment order.',
    });
  }

  // 2. Use the server-fetched Razorpay order ID
  const serverOrderId = orderDetails.id;

  if (serverOrderId !== razorpay_order_id) {
    logger.warn('Payment order ID mismatch', {
      requestId: req.requestId,
      errorCategory: 'PAYMENT',
    });

    return res.status(400).json({
      success: false,
      error: 'Payment order verification failed.',
    });
  }

  // 3. Verify payment ownership
  const orderUserId = orderDetails?.notes?.userId;

  if (!orderUserId || String(orderUserId) !== String(decoded.id)) {
    logger.warn('Payment ownership mismatch', {
      requestId: req.requestId,
      errorCategory: 'PAYMENT',
    });

    return res.status(403).json({
      success: false,
      error: 'Payment order does not belong to the current user.',
    });
  }

  // 4. Get plan from the server-side Razorpay order
  const orderPlan = orderDetails?.notes?.plan;

  if (!orderPlan || !PRODUCTS[orderPlan]) {
    return res.status(400).json({
      success: false,
      error: 'Invalid payment order plan.',
    });
  }

  const product = PRODUCTS[orderPlan];

  // 4A. Verify the Razorpay order amount and currency
  // Never trust amount/currency values coming from the frontend.

  if (
    Number(orderDetails.amount) !== Number(product.amountInr) ||
    String(orderDetails.currency).toUpperCase() !== String(product.currency).toUpperCase()
  ) {
    logger.warn('Payment order amount/currency mismatch', {
      requestId: req.requestId,
      errorCategory: 'PAYMENT',
    });

    return res.status(400).json({
      success: false,
      error: 'Payment order amount or currency does not match the selected plan.',
    });
  }

  // 4B. Fetch the actual payment from Razorpay.
  // Do not trust the payment status sent by the frontend.

  let paymentDetails;

  try {
    paymentDetails = await rzp.payments.fetch(razorpay_payment_id);
  } catch (err) {
    logger.error('Razorpay payment fetch failed', {
      requestId: req.requestId,
      errorCategory: 'PAYMENT',
      error: err,
    });

    return res.status(400).json({
      success: false,
      error: 'Unable to verify payment status.',
    });
  }

  if (!paymentDetails || !paymentDetails.id) {
    return res.status(400).json({
      success: false,
      error: 'Invalid payment.',
    });
  }

  // The payment must belong to the same Razorpay order.
  if (paymentDetails.order_id !== serverOrderId) {
    logger.warn('Payment/order mismatch', {
      requestId: req.requestId,
      errorCategory: 'PAYMENT',
    });

    return res.status(400).json({
      success: false,
      error: 'Payment does not belong to this order.',
    });
  }

  // 4C. Verify the actual Razorpay payment amount and currency.
  // The payment itself must match the server-side product catalogue.

  if (
    Number(paymentDetails.amount) !== Number(product.amountInr) ||
    String(paymentDetails.currency).toUpperCase() !==
    String(product.currency).toUpperCase()
  ) {
    logger.warn('Payment amount/currency mismatch', {
      requestId: req.requestId,
      errorCategory: 'PAYMENT',
    });

    return res.status(400).json({
      success: false,
      error: 'Payment amount or currency does not match the selected plan.',
    });
  }

  // Payment must actually be successful.
  if (paymentDetails.status !== 'captured') {
    logger.warn('Payment not captured', {
      requestId: req.requestId,
      errorCategory: 'PAYMENT',
    });
    return res.status(400).json({
      success: false,
      error: 'Payment has not been successfully completed.',
    });
  }

  // 5. Verify Razorpay HMAC signature
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${serverOrderId}|${razorpay_payment_id}`)
    .digest('hex');

  let sigBuffer;
  let expectedBuffer;

  try {
    sigBuffer = Buffer.from(razorpay_signature, 'hex');
    expectedBuffer = Buffer.from(expected, 'hex');
  } catch {
    return res.status(400).json({
      success: false,
      error: 'Invalid payment signature.',
    });
  }

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    logger.warn('Payment signature mismatch', {
      requestId: req.requestId,
      errorCategory: 'PAYMENT',
    });

    return res.status(400).json({
      success: false,
      error: 'Payment verification failed: signature mismatch.',
    });
  }

  // 6. Check whether this payment was already processed
  const existingPayment = await query(
    `
    SELECT id, user_id, plan, paid_at
    FROM payments
    WHERE razorpay_payment_id = $1
       OR razorpay_order_id = $2
    LIMIT 1
    `,
    [razorpay_payment_id, serverOrderId]
  );

  if (existingPayment.rowCount > 0) {
    const existingPaymentRecord = existingPayment.rows[0];

    // Prevent another user from reusing this payment
    if (
      String(existingPaymentRecord.user_id) !==
      String(decoded.id)
    ) {
      logger.warn('Payment reuse attempt detected', {
        requestId: req.requestId,
        errorCategory: 'PAYMENT',
      });
      return res.status(403).json({
        success: false,
        error: 'This payment belongs to another user.',
      });
    }

    return res.status(200).json({
      success: true,
      alreadyProcessed: true,
      plan: existingPaymentRecord.plan,
      paidAt: existingPaymentRecord.paid_at,
      message: 'This payment has already been processed.',
    });
  }

  // 7. Calculate subscription expiry
  const currentUser = await query(
    `
  SELECT expires_at, is_pro, subscription_status
  FROM users
  WHERE id = $1
  LIMIT 1
  `,
    [decoded.id]
  );

  if (currentUser.rowCount === 0) {
    return res.status(404).json({
      success: false,
      error: 'User account not found.',
    });
  }

  const existingExpiry = currentUser.rows[0].expires_at
    ? new Date(currentUser.rows[0].expires_at)
    : null;

  const now = new Date();

  const subscriptionStart =
    existingExpiry && existingExpiry > now
      ? existingExpiry
      : now;

  const expiresAt = new Date(
    subscriptionStart.getTime() +
    product.days * 24 * 60 * 60 * 1000
  );

  // 8. Payment + user update must happen in ONE transaction
  try {
    await withTransaction(async (client) => {

      // Record the verified payment
      await client.query(
        `
      INSERT INTO payments (
        user_id,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        amount,
        currency,
        plan,
        status,
        paid_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `,
        [
          decoded.id,
          serverOrderId,
          razorpay_payment_id,
          razorpay_signature,
          product.amountInr,
          product.currency,
          orderPlan,
          'captured',
        ]
      );

      // Activate Pro for the authenticated user
      const result = await client.query(
        `
      UPDATE users
         SET is_pro = true,
             is_ad_free = true,
             plan = $1,
             subscription_status = 'active',
             expires_at = $2,
             pro_plan = $3,
             pro_purchased_at = NOW(),
             razorpay_order_id = $4,
             razorpay_payment_id = $5
       WHERE id = $6
       RETURNING id
      `,
        [
          orderPlan,
          expiresAt.toISOString(),
          product.name,
          serverOrderId,
          razorpay_payment_id,
          decoded.id,
        ]
      );

      if (result.rowCount === 0) {
        throw new Error('User account not found.');
      }
    });

    return res.json({
      success: true,
      plan: orderPlan,
      expiresAt: expiresAt.toISOString(),
      message: `Welcome to PicCraft Pro! Your ${product.name} is active until ${expiresAt.toLocaleDateString()}.`,
    });

  } catch (err) {

    logger.error('Payment verification transaction failed', {
      requestId: req.requestId,
      errorCategory: 'PAYMENT',
      error: err,
    });

    // PostgreSQL unique constraint
    if (err.code === '23505') {
      return res.status(200).json({
        success: true,
        alreadyProcessed: true,
        message: 'This payment has already been processed.',
      });
    }

    if (err.message === 'User account not found.') {
      return res.status(404).json({
        success: false,
        error: 'User account not found.',
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Payment verified but account update failed. Contact support.',
    });
  }
}

async function verifyRedirect(req, res) {
  const frontendUrl = process.env.FRONTEND_URL;

  if (!frontendUrl) {
    logger.error('FRONTEND_URL is not configured', {
      requestId: req.requestId,
      errorCategory: 'CONFIGURATION',
    });

    return res.status(500).json({
      success: false,
      error: 'Payment redirect is not configured.',
    });
  }

  let validatedFrontendUrl;

  try {
    const url = new URL(frontendUrl);

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Invalid FRONTEND_URL protocol.');
    }

    validatedFrontendUrl = url.origin;
  } catch (err) {
    logger.error('Invalid FRONTEND_URL configuration', {
      requestId: req.requestId,
      errorCategory: 'CONFIGURATION',
      error: err,
    });

    return res.status(500).json({
      success: false,
      error: 'Payment redirect is not configured.',
    });
  }

  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.redirect(
        `${validatedFrontendUrl}?payment=error&message=Missing+payment+fields`
      );
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keySecret || keySecret.includes('REPLACE_WITH')) {
      return res.redirect(
        `${validatedFrontendUrl}?payment=error&message=Payment+gateway+not+configured`
      );
    }

    const rzp = getRazorpay();

    if (!rzp) {
      return res.redirect(
        `${validatedFrontendUrl}?payment=error&message=Payment+gateway+not+configured`
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // 1. Fetch the order directly from Razorpay.
    // ─────────────────────────────────────────────────────────────────────
    let orderDetails;

    try {
      orderDetails = await rzp.orders.fetch(razorpay_order_id);
    } catch (err) {
      logger.error('Redirect order fetch failed', {
        requestId: req.requestId,
        errorCategory: 'PAYMENT',
        error: err,
      });

      return res.redirect(
        `${validatedFrontendUrl}?payment=failed&message=Unable+to+verify+payment+order`
      );
    }

    if (!orderDetails || !orderDetails.id) {
      return res.redirect(
        `${validatedFrontendUrl}?payment=failed&message=Invalid+payment+order`
      );
    }

    // Never trust the order ID independently from Razorpay.
    const serverOrderId = orderDetails.id;

    if (serverOrderId !== razorpay_order_id) {
      logger.warn('Redirect order ID mismatch', {
        requestId: req.requestId,
        errorCategory: 'PAYMENT',
      });
      return res.redirect(
        `${validatedFrontendUrl}?payment=failed&message=Payment+order+verification+failed`
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. Get user and plan ONLY from Razorpay order notes.
    // ─────────────────────────────────────────────────────────────────────
    const userId = orderDetails?.notes?.userId;
    const planId = orderDetails?.notes?.plan;

    if (!userId) {
      logger.warn('Redirect payment missing user ID', {
        requestId: req.requestId,
        errorCategory: 'PAYMENT',
      });

      return res.redirect(
        `${validatedFrontendUrl}?payment=failed&message=Payment+ownership+could+not+be+verified`
      );
    }

    if (!planId || !PRODUCTS[planId]) {
      logger.warn('Redirect payment has invalid plan', {
        requestId: req.requestId,
        errorCategory: 'PAYMENT',
      });

      return res.redirect(
        `${validatedFrontendUrl}?payment=failed&message=Invalid+payment+plan`
      );
    }

    const product = PRODUCTS[planId];

    // ─────────────────────────────────────────────────────────────────────
    // 3. Verify ORDER amount and currency.
    // ─────────────────────────────────────────────────────────────────────
    if (
      Number(orderDetails.amount) !== Number(product.amountInr) ||
      String(orderDetails.currency).toUpperCase() !==
      String(product.currency).toUpperCase()
    ) {
      logger.warn('Redirect order amount/currency mismatch', {
        requestId: req.requestId,
        errorCategory: 'PAYMENT',
      });
      return res.redirect(
        `${validatedFrontendUrl}?payment=failed&message=Payment+amount+or+currency+is+invalid`
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. Verify Razorpay HMAC signature using server-fetched order ID.
    // ─────────────────────────────────────────────────────────────────────
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${serverOrderId}|${razorpay_payment_id}`)
      .digest('hex');

    let sigBuffer;
    let expectedBuffer;

    try {
      sigBuffer = Buffer.from(razorpay_signature, 'hex');
      expectedBuffer = Buffer.from(expected, 'hex');
    } catch {
      return res.redirect(
        `${validatedFrontendUrl}?payment=failed&message=Invalid+payment+signature`
      );
    }

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      logger.warn('Redirect payment signature mismatch', {
        requestId: req.requestId,
        errorCategory: 'PAYMENT',
      });
      return res.redirect(
        `${validatedFrontendUrl}?payment=failed&message=Signature+mismatch`
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. Fetch the actual Razorpay payment.
    // ─────────────────────────────────────────────────────────────────────
    let paymentDetails;

    try {
      paymentDetails = await rzp.payments.fetch(razorpay_payment_id);
    } catch (err) {
      logger.error('Redirect payment fetch failed', {
        requestId: req.requestId,
        errorCategory: 'PAYMENT',
        error: err,
      });

      return res.redirect(
        `${validatedFrontendUrl}?payment=failed&message=Unable+to+verify+payment`
      );
    }

    if (!paymentDetails || !paymentDetails.id) {
      return res.redirect(
        `${validatedFrontendUrl}?payment=failed&message=Invalid+payment`
      );
    }

    // Payment must belong to this order.
    if (paymentDetails.order_id !== serverOrderId) {
      logger.warn('Redirect payment/order mismatch', {
        requestId: req.requestId,
        errorCategory: 'PAYMENT',
      });
      return res.redirect(
        `${validatedFrontendUrl}?payment=failed&message=Payment+does+not+belong+to+this+order`
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. Verify ACTUAL payment amount and currency.
    // ─────────────────────────────────────────────────────────────────────
    if (
      Number(paymentDetails.amount) !== Number(product.amountInr) ||
      String(paymentDetails.currency).toUpperCase() !==
      String(product.currency).toUpperCase()
    ) {
      logger.warn('Redirect payment amount/currency mismatch', {
        requestId: req.requestId,
        errorCategory: 'PAYMENT',
      });

      return res.redirect(
        `${validatedFrontendUrl}?payment=failed&message=Payment+amount+or+currency+does+not+match`
      );
    }

    // Payment must actually be captured.
    if (paymentDetails.status !== 'captured') {
      logger.warn('Redirect payment not captured', {
        requestId: req.requestId,
        errorCategory: 'PAYMENT',
      });

      return res.redirect(
        `${validatedFrontendUrl}?payment=failed&message=Payment+was+not+successfully+completed`
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7. Prevent duplicate payment processing.
    // ─────────────────────────────────────────────────────────────────────
    const existingPayment = await query(
      `
      SELECT id, user_id, plan, status
      FROM payments
      WHERE razorpay_payment_id = $1
         OR razorpay_order_id = $2
      LIMIT 1
      `,
      [razorpay_payment_id, serverOrderId]
    );

    if (existingPayment.rowCount > 0) {
      return res.redirect(
        `${validatedFrontendUrl}?payment=success&plan=${encodeURIComponent(planId)}`
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // 8. Calculate subscription expiry from server-side product catalogue.
    // ─────────────────────────────────────────────────────────────────────
    const currentUser = await query(
      `
  SELECT expires_at
  FROM users
  WHERE id = $1
  LIMIT 1
  `,
      [userId]
    );

    if (currentUser.rowCount === 0) {
      return res.redirect(
        `${validatedFrontendUrl}?payment=error&message=User+account+not+found`
      );
    }

    const existingExpiry = currentUser.rows[0].expires_at
      ? new Date(currentUser.rows[0].expires_at)
      : null;

    const now = new Date();

    const subscriptionStart =
      existingExpiry && existingExpiry > now
        ? existingExpiry
        : now;

    const expiresAt = new Date(
      subscriptionStart.getTime() +
      product.days * 24 * 60 * 60 * 1000
    );

    // 9. Atomically insert payment + activate Pro.
    try {
      await withTransaction(async (client) => {

        // Re-check inside transaction to protect against concurrent requests.
        const duplicateCheck = await client.query(
          `
      SELECT id
      FROM payments
      WHERE razorpay_payment_id = $1
         OR razorpay_order_id = $2
      LIMIT 1
      FOR UPDATE
      `,
          [razorpay_payment_id, serverOrderId]
        );

        if (duplicateCheck.rowCount > 0) {
          return;
        }

        await client.query(
          `
      INSERT INTO payments (
        user_id,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        amount,
        currency,
        plan,
        status,
        paid_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `,
          [
            userId,
            serverOrderId,
            razorpay_payment_id,
            razorpay_signature,
            product.amountInr,
            product.currency,
            planId,
            'captured',
          ]
        );

        const userResult = await client.query(
          `
      UPDATE users
         SET is_pro = true,
             is_ad_free = true,
             plan = $1,
             subscription_status = 'active',
             expires_at = $2,
             pro_plan = $3,
             pro_purchased_at = NOW(),
             razorpay_order_id = $4,
             razorpay_payment_id = $5
       WHERE id = $6
       RETURNING id
      `,
          [
            planId,
            expiresAt.toISOString(),
            product.name,
            serverOrderId,
            razorpay_payment_id,
            userId,
          ]
        );

        if (userResult.rowCount === 0) {
          throw new Error('User account not found during redirect payment.');
        }
      });

      return res.redirect(
        `${validatedFrontendUrl}?payment=success&plan=${encodeURIComponent(planId)}`
      );

    } catch (transactionError) {
      logger.error('Redirect payment transaction failed', {
        requestId: req.requestId,
        errorCategory: 'PAYMENT',
        error: transactionError,
      });

      return res.redirect(
        `${validatedFrontendUrl}?payment=error&message=Payment+verified+but+account+update+failed`
      );
    }


  } catch (err) {
    logger.error('Payment redirect verification failed', {
      requestId: req.requestId,
      errorCategory: 'PAYMENT',
      error: err,
    });

    return res.redirect(
      `${validatedFrontendUrl}?payment=error&message=Payment+verification+failed`
    );
  }
}

module.exports = { getConfig, createOrder, verifyPayment, verifyRedirect };

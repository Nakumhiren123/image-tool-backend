const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { query } = require('../db/pool');
const { withTransaction } = require('../db/transaction');
const { extractUserMetadata, JWT_SECRET } = require('../middleware/auth');
const crypto = require('crypto');
const {
  clearLoginFailures,
} = require('../middleware/loginProtection');

const logger = require('../utils/logger');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!GOOGLE_CLIENT_ID) {
  throw new Error(
    '[FATAL] GOOGLE_CLIENT_ID is missing from environment variables.'
  );
}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

const ALLOWED_REGISTER_FIELDS = new Set([
  'name',
  'email',
  'password',
]);

const ALLOWED_LOGIN_FIELDS = new Set([
  'email',
  'password',
]);

const ALLOWED_GOOGLE_FIELDS = new Set([
  'credential',
]);

const ALLOWED_SET_PASSWORD_FIELDS = new Set([
  'password',
  'confirmPassword',
]);

function hasOnlyAllowedFields(body, allowedFields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }

  return Object.keys(body).every((key) => allowedFields.has(key));
}

function validateName(value) {
  if (typeof value !== 'string') {
    return 'Name is required.';
  }

  const name = value.trim();

  if (!name) {
    return 'Name is required.';
  }

  if (name.length > MAX_NAME_LENGTH) {
    return `Name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }

  return null;
}

function validateEmail(value) {
  if (typeof value !== 'string') {
    return 'Invalid email address.';
  }

  const email = value.trim().toLowerCase();

  if (!email || email.length > MAX_EMAIL_LENGTH) {
    return 'Invalid email address.';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Invalid email address.';
  }

  return null;
}

function validatePassword(value) {
  if (typeof value !== 'string') {
    return 'Password is required.';
  }

  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  }

  if (!/[a-z]/.test(value)) {
    return 'Password must contain at least one lowercase letter.';
  }

  if (!/[A-Z]/.test(value)) {
    return 'Password must contain at least one uppercase letter.';
  }

  if (!/[0-9]/.test(value)) {
    return 'Password must contain at least one number.';
  }

  return null;
}

// ── Cookie helper ─────────────────────────────────────────────────────────────
// When backend and frontend are on different domains (e.g. Vercel + Netlify),
// SameSite must be 'none' + Secure=true for the cookie to be sent cross-origin.
// When on the same domain or localhost, 'lax' is fine.
const getAuthCookieOptions = () => {
  const isProd = process.env.NODE_ENV === 'production';
  const isCrossOrigin =
    !!process.env.FRONTEND_URL &&
    !process.env.FRONTEND_URL.includes('localhost');

  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd && isCrossOrigin ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
};

function setCookie(res, token) {
  res.cookie('token', token, getAuthCookieOptions());
}

// ── Subscription expiry helper ────────────────────────────────────────────────
async function checkSubscriptionStatus(user) {
  if (!user) return user;
  if (user.expires_at && new Date(user.expires_at) < new Date()) {
    try {
      await query(
        `UPDATE users
            SET is_pro = false,
                is_ad_free = false,
                plan = 'free',
                subscription_status = 'expired'
          WHERE id = $1`,
        [user.id]
      );
      user.is_pro = false;
      user.is_ad_free = false;
      user.plan = 'free';
      user.subscription_status = 'expired';
    } catch (e) {
      logger.error('Auto downgrade failed', {
        requestId: null,
        errorCategory: 'AUTHENTICATION',
        error: e,
      });
    }
  }
  return user;
}

// ── Format user payload ───────────────────────────────────────────────────────
async function formatUserObj(user) {
  if (!user) return null;

  const isAdmin = user.is_admin === true;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    browser: user.browser,
    os: user.os,
    language: user.language,
    timezone: user.timezone,
    createdAt: user.created_at,
    lastLogin: user.last_login,
    is_pro: !!user.is_pro,
    is_ad_free: !!user.is_ad_free,
    is_admin: isAdmin,
    plan: user.plan || 'free',
    subscription_status: user.subscription_status || 'free',
    expires_at: user.expires_at || null,
  };
}

// ── Register ──────────────────────────────────────────────────────────────────
async function register(req, res) {
  try {
    if (!hasOnlyAllowedFields(req.body, ALLOWED_REGISTER_FIELDS)) {
      return res.status(400).json({
        success: false,
        error: 'Unexpected request fields.',
      });
    }

    const { name, email, password } = req.body || {};

    const nameError = validateName(name);

    if (nameError) {
      return res.status(400).json({
        success: false,
        error: nameError
      });
    }

    const emailError = validateEmail(email);

    if (emailError) {
      return res.status(400).json({
        success: false,
        error: emailError
      });
    }

    const passwordError = validatePassword(password);

    if (passwordError) {
      return res.status(400).json({
        success: false,
        error: passwordError
      });
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    let existingUser;
    try {
      const result = await query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
      existingUser = result.rows[0];
    } catch (dbErr) {
      logger.error('Registration database query failed', {
        requestId: req.requestId,
        errorCategory: 'DATABASE',
        error: dbErr,
      });
      return res.status(500).json({ success: false, error: 'Database error. Please try again.' });
    }

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Unable to create account with the provided information.'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12); // cost factor 12
    const meta = extractUserMetadata(req);

    const newUserRes = await query(
      `INSERT INTO users (
     name,
     email,
     password,
     ip,
     browser,
     os,
     language,
     timezone,
     last_login
   )
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
   RETURNING *`,
      [
        cleanName,
        cleanEmail,
        hashedPassword,
        meta.ip,
        meta.browser,
        meta.os,
        meta.language,
        meta.timezone,
      ]
    );
    const user = newUserRes.rows[0];

    const token = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    setCookie(res, token);

    return res.json({
      success: true,
      message: 'Signed in successfully!',
      user: await formatUserObj(user),
    });
  } catch (err) {
    logger.error('Registration failed', {
      requestId: req.requestId,
      errorCategory: 'AUTHENTICATION',
      error: err,
    });
    return res.status(500).json({ success: false, error: 'Server error during registration.' });
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function login(req, res) {
  try {

    if (!hasOnlyAllowedFields(req.body, ALLOWED_LOGIN_FIELDS)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    const { email, password } = req.body || {};

    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email or password.'
      });
    }

    if (
      email.length > MAX_EMAIL_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email or password.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    let result;
    try {
      result = await query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
    } catch (dbErr) {
      logger.error('Login database query failed', {
        requestId: req.requestId,
        errorCategory: 'DATABASE',
        error: dbErr,
      });
      return res.status(500).json({ success: false, error: 'Database error. Please try again.' });
    }

    let user = result.rows[0];

    // Use constant-time comparison to prevent timing attacks
    // (always run bcrypt even if user not found)
    const dummyHash = '$2b$12$O8bOMYq9.dAlIgoR8dpjyetp1AbtuPPWe.lmAe4.O9HjHBvcxrFtq';
    const isMatch = user?.password
      ? await bcrypt.compare(password, user.password)
      : await bcrypt.compare(password, dummyHash).then(() => false);

    if (!user || !isMatch) {
      // Generic message — don't reveal whether email exists
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    // // Block Google-only accounts from password login
    // if (user.password === 'google_oauth_secured_pass') {
    //   return res.status(400).json({ success: false, error: 'This account uses Google Sign-In. Please use "Continue with Google".' });
    // }

    user = await checkSubscriptionStatus(user);

    const meta = extractUserMetadata(req);
    await query(
      'UPDATE users SET last_login = NOW(), ip = $1, browser = $2, os = $3 WHERE id = $4',
      [meta.ip, meta.browser, meta.os, user.id]
    );

    const token = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    setCookie(res, token);

    clearLoginFailures(req);

    return res.json({
      success: true,
      message: 'Signed in successfully!',
      user: await formatUserObj(user),
    });
  } catch (err) {
    logger.error('Login failed', {
      requestId: req.requestId,
      errorCategory: 'AUTHENTICATION',
      error: err,
    });
    return res.status(500).json({ success: false, error: 'Server error during login.' });
  }
}

// ── Google OAuth ──────────────────────────────────────────────────────────────
async function googleAuth(req, res) {
  try {

    if (!hasOnlyAllowedFields(req.body, ALLOWED_GOOGLE_FIELDS)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Google authentication request.',
      });
    }

    const { credential } = req.body;

    if (!credential || typeof credential !== 'string') {
      return res.status(400).json({ success: false, error: 'Google credential is required.' });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();

      const subject = payload?.sub;


      if (
        typeof subject !== 'string' ||
        subject.length === 0 ||
        subject.length > 255
      ) {
        return res.status(401).json({
          success: false,
          error: 'Invalid Google account identifier.'
        });
      }
    } catch (verifyErr) {
      logger.error('Google token verification failed', {
        requestId: req.requestId,
        errorCategory: 'AUTHENTICATION',
        error: verifyErr,
      });
      return res.status(401).json({ success: false, error: 'Invalid or expired Google token.' });
    }

    const issuer = payload?.iss;
    const subject = payload?.sub;
    const audience = payload?.aud;
    const email = payload?.email?.trim().toLowerCase();
    const emailVerified = payload?.email_verified;
    const expiration = payload?.exp;
    const issuedAt = payload?.iat;

    const expectedClientId = GOOGLE_CLIENT_ID;

    if (!expectedClientId) {
      logger.error('GOOGLE_CLIENT_ID is not configured', {
        requestId: req.requestId,
        errorCategory: 'CONFIGURATION',
      });
      return res.status(500).json({
        success: false,
        error: 'Google authentication is not configured.'
      });
    }

    // Required issuer validation.
    if (
      issuer !== 'https://accounts.google.com' &&
      issuer !== 'accounts.google.com'
    ) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Google token issuer.'
      });
    }

    // Required audience validation.
    if (audience !== expectedClientId) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Google token audience.'
      });
    }

    // Required subject validation.
    if (
      typeof subject !== 'string' ||
      subject.length === 0 ||
      subject.length > 255
    ) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Google account identifier.'
      });
    }

    // Required email validation.
    if (
      typeof email !== 'string' ||
      !email ||
      email.length > MAX_EMAIL_LENGTH
    ) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Google account email.'
      });
    }

    // Google must have verified the email.
    if (emailVerified !== true) {
      return res.status(401).json({
        success: false,
        error: 'Google account email is not verified.'
      });
    }

    // Required expiration claim.
    if (
      typeof expiration !== 'number' ||
      !Number.isFinite(expiration) ||
      expiration <= Math.floor(Date.now() / 1000)
    ) {
      return res.status(401).json({
        success: false,
        error: 'Google token has expired.'
      });
    }

    // Required issued-at claim.
    if (
      typeof issuedAt !== 'number' ||
      !Number.isFinite(issuedAt)
    ) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Google token.'
      });
    }

    const name = payload.name || payload.given_name || email.split('@')[0];

    let result = await query(
      'SELECT * FROM users WHERE google_sub = $1',
      [subject]
    );

    let user = result.rows[0];

    if (!user) {
      // Google sub is not linked yet.
      // Check whether this email belongs to an existing account.
      const emailResult = await query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );

      const existingEmailUser = emailResult.rows[0];

      if (existingEmailUser) {
        /*
         * Existing legacy Google-only account.
         *
         * These accounts were created before google_sub was added
         * and used the old Google-only password marker.
         */
        if (existingEmailUser.password === 'google_oauth_secured_pass') {
          const meta = extractUserMetadata(req);

          const linkedResult = await query(
            `
        UPDATE users
        SET
          google_sub = $1,
          last_login = NOW(),
          ip = $2,
          browser = $3,
          os = $4
        WHERE id = $5
        RETURNING *
        `,
            [
              subject,
              meta.ip,
              meta.browser,
              meta.os,
              existingEmailUser.id
            ]
          );

          user = linkedResult.rows[0];
        } else {
          /*
           * This is a normal email/password account.
           *
           * Do NOT silently connect Google to it.
           * Explicit account linking can be added separately.
           */
          return res.status(409).json({
            success: false,
            error: 'An account already exists with this email. Please sign in with your password first.'
          });
        }
      } else {
        // Completely new Google account.
        const meta = extractUserMetadata(req);

        const newUserRes = await query(
          `
      INSERT INTO users (
        name,
        email,
        password,
        google_sub,
        ip,
        browser,
        os,
        language,
        timezone,
        last_login
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *
      `,
          [
            name,
            email,
            null,
            subject,
            meta.ip,
            meta.browser,
            meta.os,
            meta.language,
            meta.timezone
          ]
        );

        user = newUserRes.rows[0];
      }
    } else {
      // Existing Google account.
      user = await checkSubscriptionStatus(user);

      const meta = extractUserMetadata(req);

      await query(
        `
    UPDATE users
    SET
      last_login = NOW(),
      ip = $1,
      browser = $2,
      os = $3
    WHERE id = $4
    `,
        [
          meta.ip,
          meta.browser,
          meta.os,
          user.id
        ]
      );
    }

    const token = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    setCookie(res, token);

    return res.json({
      success: true,
      message: 'Signed in with Google!',
      user: await formatUserObj(user),
    });
  } catch (err) {
    logger.error('Google authentication failed', {
      requestId: req.requestId,
      errorCategory: 'AUTHENTICATION',
      error: err,
    });
    return res.status(500).json({ success: false, error: 'Google authentication failed.' });
  }
}

// ── Logout ────────────────────────────────────────────────────────────────────
async function logout(req, res) {
  const { maxAge, ...clearCookieOptions } =
    getAuthCookieOptions();

  res.clearCookie('token', clearCookieOptions);

  return res.json({
    success: true,
    message: 'Logged out successfully.',
  });
}

// ── Get current user ──────────────────────────────────────────────────────────
async function me(req, res) {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return res.json({ success: true, authenticated: false, user: null });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.json({ success: true, authenticated: false, user: null });
    }

    const result = await query(
      `
  SELECT *
  FROM users
  WHERE id = $1
    AND deleted_at IS NULL
  LIMIT 1
  `,
      [decoded.id]
    );
    let user = result.rows[0];

    if (!user) {
      return res.json({ success: true, authenticated: false, user: null });
    }

    user = await checkSubscriptionStatus(user);

    return res.json({
      success: true,
      authenticated: true,
      user: await formatUserObj(user),
    });
  } catch (err) {
    logger.error('Current user lookup failed', {
      requestId: req.requestId,
      errorCategory: 'AUTHENTICATION',
      error: err,
    });
    return res.json({ success: true, authenticated: false, user: null });
  }
}

async function deleteAccount(req, res) {
  try {

    const randomPassword = crypto.randomBytes(32).toString('hex');
    const deletedPasswordHash = await bcrypt.hash(randomPassword, 12);

    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Please sign in.'
      });
    }

    const userId = req.user.id;

    await withTransaction(async (client) => {
      // Lock the user row so concurrent account/admin operations
      // cannot make decisions from stale data.
      const userResult = await client.query(
        `
        SELECT
          id,
          is_admin,
          is_super_admin,
          deleted_at
        FROM users
        WHERE id = $1
        FOR UPDATE
        `,
        [userId]
      );

      const user = userResult.rows[0];

      if (!user) {
        const error = new Error('USER_NOT_FOUND');
        error.statusCode = 404;
        throw error;
      }

      if (user.deleted_at) {
        const error = new Error('ACCOUNT_ALREADY_DELETED');
        error.statusCode = 410;
        throw error;
      }

      // The primary/super-admin account must never be removed
      // through the normal user account deletion flow.
      if (user.is_super_admin === true) {
        const error = new Error('SUPER_ADMIN_PROTECTED');
        error.statusCode = 403;
        throw error;
      }

      // Prevent an admin from deleting the final remaining admin.
      if (user.is_admin === true) {
        const adminResult = await client.query(
          `
          SELECT COUNT(*)::int AS admin_count
          FROM users
          WHERE is_admin = true
            AND deleted_at IS NULL
          `
        );

        const adminCount = adminResult.rows[0].admin_count;

        if (adminCount <= 1) {
          const error = new Error('LAST_ADMIN_PROTECTED');
          error.statusCode = 403;
          throw error;
        }
      }

      /*
       * Soft-delete and anonymize personal information.
       *
       * Payment records are intentionally NOT deleted.
       * The payments.user_id relationship remains intact.
       */
      await client.query(
        `
  UPDATE users
  SET
    name = 'Deleted User',
    email = 'deleted-' || id::text || '@deleted.invalid',
    password = $2,
    ip = NULL,
    browser = NULL,
    os = NULL,
    language = NULL,
    timezone = NULL,

    is_pro = false,
    is_ad_free = false,
    pro_plan = NULL,
    pro_purchased_at = NULL,
    razorpay_order_id = NULL,
    razorpay_payment_id = NULL,
    plan = 'free',
    subscription_status = 'deleted',
    expires_at = NULL,

    deleted_at = NOW()
  WHERE id = $1
  `,
        [userId, deletedPasswordHash]
      );
    });

    // Invalidate the current browser session.
    const { maxAge, ...clearCookieOptions } =
      getAuthCookieOptions();

    res.clearCookie('token', clearCookieOptions);

    return res.json({
      success: true,
      message: 'Your account has been deleted successfully.'
    });

  } catch (err) {
    logger.error('Account deletion failed', {
      requestId: req.requestId,
      errorCategory: 'ACCOUNT',
      error: err,
    });

    if (err.statusCode === 404 || err.message === 'USER_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'User account not found.'
      });
    }

    if (
      err.statusCode === 410 ||
      err.message === 'ACCOUNT_ALREADY_DELETED'
    ) {
      return res.status(410).json({
        success: false,
        error: 'This account has already been deleted.'
      });
    }

    if (
      err.statusCode === 403 &&
      err.message === 'SUPER_ADMIN_PROTECTED'
    ) {
      return res.status(403).json({
        success: false,
        error: 'The primary administrator account cannot be deleted.'
      });
    }

    if (
      err.statusCode === 403 &&
      err.message === 'LAST_ADMIN_PROTECTED'
    ) {
      return res.status(403).json({
        success: false,
        error: 'The last administrator account cannot be deleted.'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Unable to delete your account.'
    });
  }
}

async function setPassword(req, res) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Please sign in.'
      });
    }

    if (!hasOnlyAllowedFields(req.body, ALLOWED_SET_PASSWORD_FIELDS)) {
      return res.status(400).json({
        success: false,
        error: 'Unexpected request fields.',
      });
    }



    const { password, confirmPassword } = req.body;

    if (
      typeof password !== 'string' ||
      typeof confirmPassword !== 'string'
    ) {
      return res.status(400).json({
        success: false,
        error: 'Password and confirmation are required.'
      });
    }

    const passwordError = validatePassword(password);

    if (passwordError) {
      return res.status(400).json({
        success: false,
        error: passwordError
      });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Passwords do not match.'
      });
    }

    const userResult = await query(
      `
      SELECT id, password, deleted_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.user.id]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User account not found.'
      });
    }

    if (user.deleted_at) {
      return res.status(403).json({
        success: false,
        error: 'This account has been deleted.'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await query(
      `
      UPDATE users
      SET password = $1
      WHERE id = $2
        AND deleted_at IS NULL
      `,
      [hashedPassword, req.user.id]
    );

    return res.json({
      success: true,
      message: 'Password set successfully.'
    });

  } catch (err) {
    logger.error('Set password failed', {
      requestId: req.requestId,
      errorCategory: 'AUTHENTICATION',
      error: err,
    });

    return res.status(500).json({
      success: false,
      error: 'Unable to set password.'
    });
  }
}


module.exports = {
  register,
  login,
  googleAuth,
  logout,
  me,
  deleteAccount,
  setPassword
};

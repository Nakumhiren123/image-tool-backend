const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { query } = require('../db/pool');
const { withTransaction } = require('../db/transaction');

// ── SECURITY: Fail fast if JWT_SECRET is not set in environment ──────────────
// Never fall back to a hardcoded string — that would defeat the purpose of a secret.
// If this throws on startup, add JWT_SECRET to your .env file.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    '[FATAL] JWT_SECRET is missing or too short in environment variables. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
  );
}

function getAuthCookieClearOptions() {
  const isProd = process.env.NODE_ENV === 'production';

  const isCrossOrigin =
    !!process.env.FRONTEND_URL &&
    !process.env.FRONTEND_URL.includes('localhost');

  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd && isCrossOrigin ? 'none' : 'lax',
    path: '/',
  };
}

/**
 * Authentication Middleware
 * Reads JWT from HttpOnly cookie only.
 * Authorization header fallback is removed to prevent token leakage via JS.
 */
async function authenticate(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Please sign in'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded?.id) {
      res.clearCookie('token', getAuthCookieClearOptions());

      return res.status(401).json({
        success: false,
        error: 'Invalid session.'
      });
    }



    const result = await query(
      `
      SELECT
        id,
        deleted_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [decoded.id]
    );

    const user = result.rows[0];

    if (!user) {
      res.clearCookie('token', getAuthCookieClearOptions());

      return res.status(401).json({
        success: false,
        error: 'User account not found.'
      });
    }

    if (user.deleted_at) {
      res.clearCookie('token', getAuthCookieClearOptions());

      return res.status(403).json({
        success: false,
        error: 'This account has been deleted.',
        code: 'ACCOUNT_DELETED'
      });
    }

    req.user = decoded;
    next();
  } catch (err) {
    logger.error('Authentication middleware failed', {
      requestId: req.requestId,
      errorCategory: 'AUTHENTICATION',
      error: err,
    });

    res.clearCookie('token', getAuthCookieClearOptions());

    return res.status(401).json({
      success: false,
      error: 'Invalid or expired session. Please sign in again.'
    });
  }
}

/**
 * PRO Subscription Middleware
 *
 * Requires:
 * 1. Valid authenticated session
 * 2. Active Pro subscription
 * 3. expires_at must be in the future
 *
 * Expired users are NOT blocked from logging in or purchasing again.
 * This middleware is only for Pro-only functionality.
 */
async function requireActivePro(req, res, next) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Please sign in'
      });
    }

    const result = await query(
      `
      SELECT
        id,
        is_pro,
        is_ad_free,
        plan,
        subscription_status,
        expires_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.user.id]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User account not found.'
      });
    }

    const now = new Date();

    const subscriptionActive =
      user.is_pro === true &&
      user.expires_at &&
      new Date(user.expires_at) > now &&
      user.subscription_status === 'active';

    if (!subscriptionActive) {

      // Keep database state synchronized when subscription has expired.
      if (
        user.is_pro === true &&
        user.expires_at &&
        new Date(user.expires_at) <= now
      ) {
        await withTransaction(async (client) => {
          await client.query(
            `
            UPDATE users
               SET is_pro = false,
                   is_ad_free = false,
                   plan = 'free',
                   subscription_status = 'expired',
                   pro_plan = NULL,
                   pro_purchased_at = NULL
             WHERE id = $1
            `,
            [req.user.id]
          );
        });
      }

      return res.status(403).json({
        success: false,
        error: 'Your Pro subscription has expired. Please renew your subscription to continue.',
        code: 'PRO_SUBSCRIPTION_EXPIRED'
      });
    }

    req.userSubscription = user;

    next();

  } catch (err) {
    logger.error('Pro subscription verification failed', {
      requestId: req.requestId,
      errorCategory: 'AUTHORIZATION',
      error: err,
    });

    return res.status(500).json({
      success: false,
      error: 'Unable to verify subscription status.'
    });
  }
}
/**
 * Parse Browser & OS from User-Agent String
 */
function parseUserAgent(ua = '') {
  let browser = 'Unknown Browser';
  let os = 'Unknown OS';

  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Linux')) os = 'Linux';

  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Safari';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('OPR/') || ua.includes('Opera/')) browser = 'Opera';

  return { browser, os };
}

/**
 * Extract Metadata from Request (IP, UA, Browser, OS, Language, Timezone)
 */
function extractUserMetadata(req) {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    '127.0.0.1';

  const userAgent = req.headers['user-agent'] || '';
  const { browser, os } = parseUserAgent(userAgent);
  const language = req.headers['accept-language']?.split(',')[0] || 'en-US';
  // Timezone sent as a cookie set by the frontend (Intl API), never from untrusted header
  const timezone = req.cookies?.user_tz || 'UTC';

  return { ip, userAgent, browser, os, language, timezone };
}

/**
 * Admin Authentication Middleware
 * Double-checks admin status against DB on every request (not just JWT claim).
 */
async function requireAdmin(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Admin login required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const result = await query(
      'SELECT id,email, is_admin, is_super_admin FROM users WHERE id = $1',
      [decoded.id]
    );
    const user = result.rows[0];

    const isAdmin = user?.is_admin === true;

    if (!user || !isAdmin) {
      return res.status(403).json({ success: false, error: 'Access denied: Admin privileges required.' });
    }

    req.user = user;
    next();
  } catch (err) {

    res.clearCookie('token', getAuthCookieClearOptions());

    return res.status(401).json({ success: false, error: 'Invalid or expired admin session.' });
  }
}

module.exports = {
  authenticate,
  requireActivePro,
  requireAdmin,
  extractUserMetadata,
  JWT_SECRET,
};

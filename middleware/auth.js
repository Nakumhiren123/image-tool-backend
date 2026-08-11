const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'piccraft_secret_jwt_key_2026_super_secure';

/**
 * Authentication Middleware
 * Checks HttpOnly cookie 'token' or Bearer header
 */
function authenticate(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Please sign in' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session. Please sign in again.' });
  }
}

/**
 * Parse Browser & OS from User-Agent String
 */
function parseUserAgent(ua = '') {
  let browser = 'Unknown Browser';
  let os = 'Unknown OS';

  // Detect OS
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  // Detect Browser
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
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || req.ip || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || '';
  const { browser, os } = parseUserAgent(userAgent);
  const language = req.headers['accept-language']?.split(',')[0] || 'en-US';
  const timezone = req.cookies?.user_tz || req.headers['x-timezone'] || 'UTC';

  return {
    ip,
    userAgent,
    browser,
    os,
    language,
    timezone,
  };
}

/**
 * Admin Authentication Middleware
 * Ensures only users with is_admin = true (or matching ADMIN_EMAIL env) can access route.
 */
async function requireAdmin(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Admin login required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { query } = require('../db/pool');
    const result = await query('SELECT id, email, is_admin FROM users WHERE id = $1', [decoded.id]);
    const user = result.rows[0];

    const adminEmail = process.env.ADMIN_EMAIL || '';
    const isAdmin = user?.is_admin || (adminEmail && user?.email?.toLowerCase() === adminEmail.toLowerCase());

    if (!user || !isAdmin) {
      return res.status(403).json({ success: false, error: 'Access denied: Admin privileges required.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired admin session.' });
  }
}

module.exports = {
  authenticate,
  requireAdmin,
  extractUserMetadata,
  JWT_SECRET,
};

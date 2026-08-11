const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { query } = require('../db/pool');
const { extractUserMetadata, JWT_SECRET } = require('../middleware/auth');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * User Registration
 * Requires: name, email, password
 * Collects extra browser metadata from headers/cookies
 */
async function register(req, res) {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, Email, and Password are all required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    let existingUser;
    try {
      const result = await query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
      existingUser = result.rows[0];
    } catch (dbErr) {
      console.error('PostgreSQL Database Error:', dbErr);
      return res.status(500).json({
        success: false,
        error: 'Database connection failed. Please ensure PostgreSQL service is running.'
      });
    }

    if (existingUser) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const meta = extractUserMetadata(req);

    const insertQuery = `
      INSERT INTO users (name, email, password, ip, user_agent, browser, os, language, timezone, last_login)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING id, name, email, browser, os, created_at;
    `;

    const newUserRes = await query(insertQuery, [
      name.trim(),
      cleanEmail,
      hashedPassword,
      meta.ip,
      meta.userAgent,
      meta.browser,
      meta.os,
      meta.language,
      meta.timezone,
    ]);

    const user = newUserRes.rows[0];

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      user: await formatUserObj(user),
    });

  } catch (err) {
    console.error('Registration Error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Server error during registration' });
  }
}

/**
 * Helper to automatically check and downgrade expired subscriptions
 */
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
      console.error('Auto downgrade error:', e);
    }
  }
  return user;
}

/**
 * Helper to format user payload and auto-promote ADMIN_EMAIL in DB
 */
async function formatUserObj(user) {
  if (!user) return null;
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const userEmail = (user.email || '').trim().toLowerCase();
  const isAdmin = !!user.is_admin || (!!adminEmail && userEmail === adminEmail);

  if (isAdmin && !user.is_admin) {
    try {
      await query('UPDATE users SET is_admin = true WHERE id = $1', [user.id]);
      user.is_admin = true;
    } catch (e) {
      console.error('Auto admin update error:', e);
    }
  }

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

/**
 * User Login
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and Password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    let result;
    try {
      result = await query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
    } catch (dbErr) {
      console.error('PostgreSQL Database Error:', dbErr);
      return res.status(500).json({
        success: false,
        error: 'Database connection error. Check PostgreSQL status in backend/.env'
      });
    }

    let user = result.rows[0];
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    // Auto check if subscription has expired
    user = await checkSubscriptionStatus(user);

    const meta = extractUserMetadata(req);
    await query(
      'UPDATE users SET last_login = NOW(), ip = $1, user_agent = $2, browser = $3, os = $4 WHERE id = $5',
      [meta.ip, meta.userAgent, meta.browser, meta.os, user.id]
    );

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      message: 'Signed in successfully!',
      user: await formatUserObj(user),
    });

  } catch (err) {
    console.error('Login Error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Server error during login' });
  }
}

/**
 * Google OAuth Login & Registration
 */
async function googleAuth(req, res) {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ success: false, error: 'Google credential is required.' });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.error('Google token verification failed:', verifyErr.message);
      return res.status(401).json({ success: false, error: 'Invalid or expired Google token.' });
    }

    const email = payload.email;
    const name = payload.name || payload.given_name || email.split('@')[0];

    if (!email) {
      return res.status(400).json({ success: false, error: 'Google account has no email.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    let result = await query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
    let user = result.rows[0];

    if (!user) {
      const meta = extractUserMetadata(req);
      const insertQuery = `
        INSERT INTO users (name, email, password, ip, user_agent, browser, os, language, timezone, last_login)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        RETURNING *;
      `;
      const newUserRes = await query(insertQuery, [
        name || cleanEmail.split('@')[0],
        cleanEmail,
        'google_oauth_secured_pass',
        meta.ip,
        meta.userAgent,
        meta.browser,
        meta.os,
        meta.language,
        meta.timezone,
      ]);
      user = newUserRes.rows[0];
    } else {
      user = await checkSubscriptionStatus(user);
      const meta = extractUserMetadata(req);
      await query(
        'UPDATE users SET last_login = NOW(), ip = $1, user_agent = $2, browser = $3, os = $4 WHERE id = $5',
        [meta.ip, meta.userAgent, meta.browser, meta.os, user.id]
      );
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      message: 'Signed in with Google!',
      user: await formatUserObj(user),
    });

  } catch (err) {
    console.error('Google Auth Error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Google Auth Error' });
  }
}

/**
 * User Logout
 */
async function logout(req, res) {
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax',
  });
  return res.json({ success: true, message: 'Logged out successfully.' });
}

/**
 * Get Current Logged-in User Profile
 */
async function me(req, res) {
  try {
    const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.json({ success: true, authenticated: false, user: null });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.json({ success: true, authenticated: false, user: null });
    }

    const result = await query('SELECT * FROM users WHERE id = $1', [decoded.id]);
    let user = result.rows[0];

    if (!user) {
      return res.json({ success: true, authenticated: false, user: null });
    }

    // Auto check if subscription has expired
    user = await checkSubscriptionStatus(user);

    return res.json({
      success: true,
      authenticated: true,
      user: await formatUserObj(user),
    });
  } catch (err) {
    return res.json({ success: true, authenticated: false, user: null });
  }
}

module.exports = {
  register,
  login,
  googleAuth,
  logout,
  me,
};

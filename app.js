require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const multer = require('multer');

const {
  csrfProtection,
} = require('./middleware/csrfProtection');

const imageRoutes = require('./routes/imageRoutes');
const authRoutes = require('./routes/authRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adRoutes = require('./routes/adRoutes');
// const { initDb } = require('./db/pool');

const privacyMaintenanceRoutes = require('./routes/privacyMaintenanceRoutes');

const requestLogger = require('./middleware/requestLogger');

const logger = require('./utils/logger');
const { query } = require('./db/pool');

const app = express();

app.set('trust proxy', 1);

const MAX_UPLOAD_MB = parseInt(
  process.env.MAX_UPLOAD_MB || '10',
  10
);

app.disable('x-powered-by');

// ── CORS ──────────────────────────────────────────────────────────────────────
// Only allow explicitly listed origins. Never use a wildcard when
// credentials: true — that would be a CORS misconfiguration.
const ALLOWED_ORIGINS = [
  ...(process.env.NODE_ENV !== 'production'
    ? [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]
    : []),
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server requests (no Origin header) only in dev
    if (!origin && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-CSRF-Token',
  ],
}));

// Limit JSON/form request bodies to prevent unnecessarily large
// authentication and API payloads.
// Image uploads are handled separately by Multer.
app.use(express.json({ limit: '16kb' }));

app.use(express.urlencoded({
  extended: true,
  limit: '16kb'
}));
app.use(cookieParser());

app.use(requestLogger);


// ── Security Headers ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0'); // Modern browsers: rely on CSP not this
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Allow Google OAuth popup without breaking
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader(
    'Cross-Origin-Resource-Policy',
    'same-site'
  );

  // HSTS — production HTTPS only
  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  next();
});

// ── Rate Limiting ──────────────────────────────────────────────────────────────
// Auth endpoints: stricter limit to slow brute-force attacks
const authLimiter = rateLimit({
  windowMs: parseInt(
    process.env.AUTH_RATE_LIMIT_WINDOW_MS || '900000',
    10
  ),

  max: parseInt(
    process.env.AUTH_RATE_LIMIT_MAX || '20',
    10
  ),

  standardHeaders: true,
  legacyHeaders: false,

  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again later.',
  },
});
// General API limiter
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please slow down.' },
  skip: () => process.env.NODE_ENV === 'development',
});

// Image processing limiter
const imageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many image processing requests. Please try again later.',
  },
  skip: () => process.env.NODE_ENV === 'development',
});

// Payment limiter
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many payment requests. Please try again later.',
  },
  skip: () => process.env.NODE_ENV === 'development',
});

// Admin limiter
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many admin requests. Please try again later.',
  },
  skip: () => process.env.NODE_ENV === 'development',
});

app.use('/api/', apiLimiter);

app.use('/api/convert', imageLimiter);
app.use('/api/compress', imageLimiter);
app.use('/api/resize', imageLimiter);

app.use('/api/payment/create-order', paymentLimiter);
app.use('/api/payment/verify', paymentLimiter);
app.use('/api/payment/verify-redirect', paymentLimiter);

app.use('/api/admin', adminLimiter);

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/google', authLimiter);

app.use('/api/maintenance', privacyMaintenanceRoutes);


// ── DB Init (lazy, safe for Vercel serverless) ────────────────────────────────
// let dbInitialized = false;
// app.use((req, res, next) => {
//   if (!dbInitialized) {
//     dbInitialized = true;
//     initDb().catch(console.error);
//   }
//   next();
// });

// ── Health Checks ────────────────────────────────────────────────────────────

// Liveness:
// Only confirms that the Node.js/Express process is alive.
// It does NOT check external dependencies.
app.get('/api/health/live', (req, res) => {
  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  });
});

// Readiness:
// Confirms that the application can reach PostgreSQL.
// Never expose database host, database name, credentials,
// connection strings, or other internal database details.
app.get('/api/health/ready', async (req, res) => {
  try {
    // const { query } = require('./db/pool');

    await query('SELECT 1');

    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  } catch (err) {
    logger.error('Readiness check failed', {
      requestId: req.requestId,
      errorCategory: 'HEALTH_DATABASE',
      error: err,
    });

    return res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  }
});

// Backward-compatible public health endpoint.
// Keep the existing /api/health URL, but do not expose
// internal architecture or database information.
app.get('/api/health', (req, res) => {
  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', adRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', imageRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found.',
    requestId: req.requestId,
  });
});
// ── Global error handler ──────────────────────────────────────────────────────
// Must be registered AFTER all routes and the 404 handler.
// Never expose internal implementation details to clients.
app.use((err, req, res, next) => {
  // Detailed error stays server-side only.
  logger.error('Unhandled application error', {
    requestId: req.requestId,
    method: req.method,
    route: req.path,
    errorCategory: 'INTERNAL',
    error: err,
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Multer errors
  // ───────────────────────────────────────────────────────────────────────────
  if (err instanceof multer.MulterError || err?.name === 'MulterError') {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          success: false,
          error: `File is too large. Maximum upload size is ${MAX_UPLOAD_MB} MB.`,
          requestId: req.requestId,
        });

      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          error: 'Too many files uploaded.',
          requestId: req.requestId,
        });

      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          error: 'Unexpected file upload.',
          requestId: req.requestId,
        });

      case 'LIMIT_FIELD_COUNT':
      case 'LIMIT_FIELD_KEY':
      case 'LIMIT_FIELD_VALUE':
        return res.status(400).json({
          success: false,
          error: 'Invalid upload data.',
          requestId: req.requestId,
        });

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid file upload.',
          requestId: req.requestId,
        });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Custom file validation errors
  // ───────────────────────────────────────────────────────────────────────────
  if (err?.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({
      success: false,
      error: 'Invalid image file type.',
      requestId: req.requestId,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // JSON/body-parser validation errors
  // ───────────────────────────────────────────────────────────────────────────
  if (
    err?.type === 'entity.parse.failed' ||
    err instanceof SyntaxError
  ) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request data.',
      requestId: req.requestId,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rate-limit errors
  // ───────────────────────────────────────────────────────────────────────────
  if (
    err?.status === 429 ||
    err?.statusCode === 429 ||
    err?.code === 'RATE_LIMITED'
  ) {
    return res.status(429).json({
      success: false,
      error: 'Too many requests. Please try again later.',
      requestId: req.requestId,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CORS errors
  // ───────────────────────────────────────────────────────────────────────────
  if (
    typeof err?.message === 'string' &&
    err.message.startsWith('CORS:')
  ) {
    return res.status(403).json({
      success: false,
      error: 'Request origin is not allowed.',
      requestId: req.requestId,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Unknown/internal errors
  // ───────────────────────────────────────────────────────────────────────────
  return res.status(500).json({
    success: false,
    error: 'Internal server error.',
    requestId: req.requestId,
  });
});

// ── Local dev server ──────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    logger.info('Backend started', {
      port: PORT,
      environment: process.env.NODE_ENV || 'development',
    });
  });
}

module.exports = app;
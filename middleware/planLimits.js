const logger = require('../utils/logger');

// Sliding window request tracking for Free tier users (max 3 image processing ops per minute)
const FREE_PLAN_MAX_IMAGES_PER_WINDOW = 3;
const WINDOW_MS = 60 * 1000; // 1 minute

/**
 * IMPORTANT — SERVERLESS LIMITATION:
 * This in-memory Map resets on every Vercel serverless cold start
 * (typically after ~30 seconds of inactivity). This means the sliding
 * window rate limit can be bypassed by users who wait between requests.
 *
 * The PRIMARY server-side enforcement is in imageController.js via
 * PLAN_LIMITS (maxBatchSize: 3 per request) — this is stateless and
 * always enforced regardless of cold starts.
 *
 * TODO (post-launch): Replace this Map with Vercel KV or Upstash Redis
 * for persistent rate limiting across serverless instances:
 * https://vercel.com/docs/storage/vercel-kv
 */
// Note: Map entries older than WINDOW_MS are filtered inline on each
// request. No periodic cleanup needed — on Vercel serverless each cold
// start resets this Map automatically. For persistent rate limiting
// across instances, migrate to Vercel KV (see TODO comment above).
const freeUserRequests = new Map();

/**
 * Middleware to enforce Free Plan processing limits server-side.
 * Pro users have unlimited access.
 * Free users are restricted to 3 image operations per 1-minute window.
 */
function checkPlanLimits(req, res, next) {
  // Pro users bypass free batch limits
  if (req.user?.is_pro) {
    return next();
  }

  const userId = req.user?.id || req.ip;
  const now = Date.now();

  const userTimestamps = freeUserRequests.get(userId) || [];
  const activeTimestamps = userTimestamps.filter(t => now - t < WINDOW_MS);

  if (activeTimestamps.length >= FREE_PLAN_MAX_IMAGES_PER_WINDOW) {
    logger.warn('Free plan batch limit exceeded on backend', {
      userId,
      requestId: req.requestId,
      count: activeTimestamps.length,
    });

    return res.status(429).json({
      success: false,
      error: 'Free plan limit reached (maximum 3 images per minute). Please upgrade to Pro for unlimited batch processing.',
      code: 'PLAN_LIMIT_EXCEEDED',
      requestId: req.requestId,
    });
  }

  activeTimestamps.push(now);
  freeUserRequests.set(userId, activeTimestamps);

  next();
}

module.exports = {
  checkPlanLimits,
  FREE_PLAN_MAX_IMAGES_PER_WINDOW,
};

const crypto = require('crypto');

const attempts = new Map();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_FAILURES = 10;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function normalizeEmail(email) {
    if (typeof email !== 'string') {
        return '';
    }

    return email.trim().toLowerCase();
}

function getClientIp(req) {
    return (
        req.ip ||
        req.socket?.remoteAddress ||
        'unknown'
    );
}

function createAttemptKey(req) {
    const email = normalizeEmail(req.body?.email);
    const ip = getClientIp(req);

    /*
     * Keep the raw email/IP out of the in-memory key.
     */
    return crypto
        .createHash('sha256')
        .update(`${ip}:${email}`)
        .digest('hex');
}

function getRecord(key) {
    const now = Date.now();
    const existing = attempts.get(key);

    if (
        !existing ||
        now - existing.firstAttemptAt >= WINDOW_MS
    ) {
        const record = {
            firstAttemptAt: now,
            failures: 0,
            lastFailureAt: 0,
        };

        attempts.set(key, record);

        return record;
    }

    return existing;
}

/*
 * Progressive delay:
 *
 * 0-2 failures  -> 0ms
 * 3 failures    -> 500ms
 * 4 failures    -> 1000ms
 * 5 failures    -> 2000ms
 * 6+ failures   -> 3000ms maximum
 */
function calculateDelay(failures) {
    if (failures < 3) {
        return 0;
    }

    return Math.min(
        500 * Math.pow(2, failures - 3),
        3000
    );
}

async function loginProtection(req, res, next) {
    const key = createAttemptKey(req);
    const record = getRecord(key);

    const delay = calculateDelay(record.failures);

    if (delay > 0) {
        await new Promise((resolve) => {
            setTimeout(resolve, delay);
        });
    }

    req.loginProtectionKey = key;

    /*
     * Count only failed authentication responses.
     */
    res.on('finish', () => {
        if (res.statusCode !== 401) {
            return;
        }

        const current = getRecord(key);

        current.failures = Math.min(
            current.failures + 1,
            MAX_TRACKED_FAILURES
        );

        current.lastFailureAt = Date.now();

        attempts.set(key, current);
    });

    next();
}

function clearLoginFailures(req) {
    const key =
        req.loginProtectionKey ||
        createAttemptKey(req);

    attempts.delete(key);
}

/*
 * Remove expired records periodically so the Map
 * does not grow forever.
 */
setInterval(() => {
    const now = Date.now();

    for (const [key, record] of attempts.entries()) {
        if (
            now - record.firstAttemptAt >= WINDOW_MS
        ) {
            attempts.delete(key);
        }
    }
}, CLEANUP_INTERVAL_MS).unref();

module.exports = {
    loginProtection,
    clearLoginFailures,
};
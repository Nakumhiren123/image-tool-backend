const crypto = require('crypto');
const logger = require('../utils/logger');

function getRoute(req) {
    if (req.route?.path) {
        return `${req.baseUrl || ''}${req.route.path}`;
    }

    return req.path || req.originalUrl?.split('?')[0] || 'unknown';
}

function requestLogger(req, res, next) {
    const incomingRequestId = req.get('X-Request-ID');

    const requestId =
        typeof incomingRequestId === 'string' &&
            incomingRequestId.length > 0 &&
            incomingRequestId.length <= 100
            ? incomingRequestId
            : `req-${crypto.randomUUID()}`;

    req.requestId = requestId;

    res.setHeader('X-Request-ID', requestId);

    const startTime = process.hrtime.bigint();

    res.on('finish', () => {
        const endTime = process.hrtime.bigint();

        const durationMs =
            Number(endTime - startTime) / 1_000_000;

        const status = res.statusCode;

        logger.info('HTTP request completed', {
            requestId,
            method: req.method,
            route: getRoute(req),
            status,
            duration: Math.round(durationMs * 100) / 100,
            errorCategory: status >= 500
                ? 'INTERNAL'
                : status >= 400
                    ? 'CLIENT'
                    : null,
        });
    });

    next();
}

module.exports = requestLogger;
const SENSITIVE_KEYS = new Set([
    'password',
    'passwordhash',
    'token',
    'accesstoken',
    'refreshtoken',
    'authorization',
    'cookie',
    'set-cookie',
    'jwt',
    'secret',
    'apikey',
    'api_key',
    'clientsecret',
    'client_secret',
    'privatekey',
    'private_key',
    'keysecret',
    'razorpay_key_secret',
    'razorpaykeysecret',
    'database_url',
    'databaseUrl',
    'credential',
    'credentials',
    'razorpay_signature',
]);

function sanitize(value, depth = 0) {
    if (depth > 3) {
        return '[truncated]';
    }

    if (value === null || value === undefined) {
        return value;
    }

    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            code: value.code,
            status: value.status,
            statusCode: value.statusCode,
            stack:
                process.env.NODE_ENV === 'production'
                    ? undefined
                    : value.stack,
        };
    }

    if (Array.isArray(value)) {
        return value
            .slice(0, 20)
            .map((item) => sanitize(item, depth + 1));
    }

    if (typeof value === 'object') {
        const result = {};

        for (const [key, val] of Object.entries(value)) {
            if (SENSITIVE_KEYS.has(key.toLowerCase())) {
                result[key] = '[REDACTED]';
                continue;
            }

            result[key] = sanitize(val, depth + 1);
        }

        return result;
    }

    return '[unsupported]';
}

function writeLog(level, message, metadata = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...sanitize(metadata),
    };

    process.stdout.write(`${JSON.stringify(entry)}\n`);
}

const logger = {
    info(message, metadata = {}) {
        writeLog('info', message, metadata);
    },

    warn(message, metadata = {}) {
        writeLog('warn', message, metadata);
    },

    error(message, metadata = {}) {
        writeLog('error', message, metadata);
    },
};

module.exports = logger;
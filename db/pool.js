const { Pool } = require('pg');
require('dotenv').config();
const logger = require('../utils/logger');

if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error(
    '[FATAL] DATABASE_URL is required in production.'
  );
}

const createPoolConfig = (connectionString, options = {}) => ({
  connectionString,

  ssl: process.env.DB_SSL === 'false'
    ? false
    : {
      rejectUnauthorized:
        process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    },

  max: options.max ?? 5,
  connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000,
  idleTimeoutMillis: options.idleTimeoutMillis ?? 10000,
});

const pool = new Pool(

  process.env.DATABASE_URL
    ? createPoolConfig(process.env.DATABASE_URL)
    : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'image-tool',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      connectionTimeoutMillis: 5000,
    }
);

pool.on('error', (err) => {
  logger.error('Unexpected idle PostgreSQL client error', {
    requestId: null,
    errorCategory: 'DATABASE',
    error: err,
  });
});

module.exports = {
  pool,

  query: (text, params) => pool.query(text, params),

  getClient: () => pool.connect(),
};
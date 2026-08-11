const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'image-tool',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        connectionTimeoutMillis: 5000,
      }
);

/**
 * Initialize PostgreSQL Schema & Migrations automatically
 */
async function initDb() {
  try {
    const client = await pool.connect();
    console.log('🐘 PostgreSQL connected successfully to database:', process.env.DB_NAME || 'production DB');

    // Create base users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        browser TEXT,
        os TEXT,
        language TEXT,
        timezone TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login TIMESTAMPTZ
      );
    `);

    // Auto-migrate additional columns if they don't exist yet
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_pro BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_ad_free BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_plan TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_purchased_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'free';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    `);

    console.log('✅ PostgreSQL Schema verified: "users" table, PRO/Ad-Free & Admin columns ready.');
    client.release();
  } catch (err) {
    console.warn('⚠️ PostgreSQL Connection Warning:', err.message);
    console.warn('💡 Tip: Make sure PostgreSQL service is running on port 5432 and password is set in backend/.env');
  }
}

module.exports = {
  pool,
  initDb,
  query: (text, params) => pool.query(text, params),
};

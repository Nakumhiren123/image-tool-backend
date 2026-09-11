/**
 * Initial database schema.
 *
 * This migration creates the baseline schema for a fresh database.
 * Later migrations modify this schema.
 */

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const up = (pgm) => {
    // Required for gen_random_uuid().
    pgm.createExtension('pgcrypto', {
        ifNotExists: true,
    });

    pgm.createTable('users', {
        id: {
            type: 'uuid',
            primaryKey: true,
            default: pgm.func('gen_random_uuid()'),
        },

        name: {
            type: 'text',
            notNull: true,
        },

        email: {
            type: 'text',
            notNull: true,
            unique: true,
        },

        password: {
            type: 'text',
            notNull: true,
        },

        ip: {
            type: 'text',
        },

        user_agent: {
            type: 'text',
        },

        browser: {
            type: 'text',
        },

        os: {
            type: 'text',
        },

        language: {
            type: 'text',
        },

        timezone: {
            type: 'text',
        },

        created_at: {
            type: 'timestamptz',
            default: pgm.func('NOW()'),
        },

        last_login: {
            type: 'timestamptz',
        },

        is_pro: {
            type: 'boolean',
            notNull: true,
            default: false,
        },

        is_ad_free: {
            type: 'boolean',
            notNull: true,
            default: false,
        },

        is_admin: {
            type: 'boolean',
            notNull: true,
            default: false,
        },

        pro_plan: {
            type: 'text',
        },

        pro_purchased_at: {
            type: 'timestamptz',
        },

        razorpay_order_id: {
            type: 'text',
        },

        razorpay_payment_id: {
            type: 'text',
        },

        plan: {
            type: 'text',
            notNull: true,
            default: 'free',
        },

        subscription_status: {
            type: 'text',
            notNull: true,
            default: 'free',
        },

        expires_at: {
            type: 'timestamptz',
        },
    });

    pgm.createTable('ads', {
        id: {
            type: 'serial',
            primaryKey: true,
        },

        title: {
            type: 'text',
            notNull: true,
        },

        position: {
            type: 'text',
            notNull: true,
            check: "position IN ('leaderboard', 'skyscraper', 'rectangle', 'interstitial')",
        },

        ad_client: {
            type: 'text',
        },

        ad_slot: {
            type: 'text',
        },

        is_active: {
            type: 'boolean',
            notNull: true,
            default: true,
        },

        created_at: {
            type: 'timestamptz',
            notNull: true,
            default: pgm.func('NOW()'),
        },

        updated_at: {
            type: 'timestamptz',
            notNull: true,
            default: pgm.func('NOW()'),
        },
    });

    pgm.createTable('payments', {
        id: {
            type: 'uuid',
            primaryKey: true,
            default: pgm.func('gen_random_uuid()'),
        },

        user_id: {
            type: 'uuid',
            notNull: true,
            references: 'users(id)',
            onDelete: 'CASCADE',
        },

        razorpay_order_id: {
            type: 'text',
            notNull: true,
        },

        razorpay_payment_id: {
            type: 'text',
        },

        razorpay_signature: {
            type: 'text',
        },

        amount: {
            type: 'integer',
            notNull: true,
        },

        currency: {
            type: 'varchar(10)',
            notNull: true,
            default: 'INR',
        },

        plan: {
            type: 'varchar(20)',
            notNull: true,
        },

        status: {
            type: 'varchar(30)',
            notNull: true,
            default: 'created',
        },

        refund_id: {
            type: 'text',
        },

        refund_status: {
            type: 'varchar(30)',
        },

        created_at: {
            type: 'timestamptz',
            notNull: true,
            default: pgm.func('NOW()'),
        },

        paid_at: {
            type: 'timestamptz',
        },

        refunded_at: {
            type: 'timestamptz',
        },
    });

    pgm.createIndex('payments', 'razorpay_order_id', {
        name: 'payments_razorpay_order_id_unique',
        unique: true,
    });

    pgm.createIndex('payments', 'razorpay_payment_id', {
        name: 'payments_razorpay_payment_id_unique',
        unique: true,
        where: 'razorpay_payment_id IS NOT NULL',
    });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const down = (pgm) => {
    pgm.dropTable('payments');
    pgm.dropTable('ads');
    pgm.dropTable('users');

    pgm.dropExtension('pgcrypto');
};
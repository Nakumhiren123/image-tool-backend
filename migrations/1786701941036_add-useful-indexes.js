/**
 * Add production indexes for common database access patterns.
 */

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
    // User subscription expiration lookups.
    pgm.createIndex('users', 'expires_at', {
        name: 'users_expires_at_idx',
    });

    // Newest-user/admin listing queries.
    pgm.createIndex('users', 'created_at', {
        name: 'users_created_at_idx',
    });

    // Only index active ads, ordered by newest first.
    pgm.createIndex('ads', 'created_at', {
        name: 'ads_active_created_at_idx',
        where: 'is_active = true',
    });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
    pgm.dropIndex('ads', 'ads_active_created_at_idx');
    pgm.dropIndex('users', 'users_created_at_idx');
    pgm.dropIndex('users', 'users_expires_at_idx');
};
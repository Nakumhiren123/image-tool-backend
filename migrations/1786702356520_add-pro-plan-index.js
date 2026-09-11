/**
 * Add targeted index for active Pro-plan queries.
 */

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
    pgm.createIndex('users', 'plan', {
        name: 'users_active_pro_plan_idx',
        where: 'is_pro = true',
    });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
    pgm.dropIndex('users', 'users_active_pro_plan_idx');
};
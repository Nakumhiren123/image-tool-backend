/**
 * Add account deletion timestamp.
 */

export const up = (pgm) => {
    pgm.addColumn('users', {
        deleted_at: {
            type: 'timestamp with time zone',
            notNull: false,
        },
    });

    pgm.createIndex('users', 'deleted_at', {
        name: 'users_deleted_at_idx',
    });
};

export const down = (pgm) => {
    pgm.dropIndex('users', 'users_deleted_at_idx');
    pgm.dropColumn('users', 'deleted_at');
};
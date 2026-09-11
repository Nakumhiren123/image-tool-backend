/**
 * Add explicit super-admin role.
 */

export const up = (pgm) => {
    pgm.addColumn('users', {
        is_super_admin: {
            type: 'boolean',
            notNull: true,
            default: false,
        },
    });
};

export const down = (pgm) => {
    pgm.dropColumn('users', 'is_super_admin');
};
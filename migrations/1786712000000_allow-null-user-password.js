export const up = (pgm) => {
    pgm.alterColumn('users', 'password', {
        type: 'text',
        notNull: false,
    });
};

export const down = (pgm) => {
    pgm.alterColumn('users', 'password', {
        type: 'text',
        notNull: true,
    });
};
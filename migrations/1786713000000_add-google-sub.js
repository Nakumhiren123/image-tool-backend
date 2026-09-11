export const up = (pgm) => {
    pgm.addColumn('users', {
        google_sub: {
            type: 'text',
            unique: true,
        },
    });
};

export const down = (pgm) => {
    pgm.dropColumn('users', 'google_sub');
};
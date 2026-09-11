/**
 * Remove raw User-Agent storage.
 *
 * Browser and OS are derived from the request User-Agent,
 * but the raw User-Agent is not needed after parsing.
 */

export const up = (pgm) => {
    pgm.dropColumn('users', 'user_agent');
};

export const down = (pgm) => {
    pgm.addColumn('users', {
        user_agent: {
            type: 'text',
            notNull: false,
        },
    });
};
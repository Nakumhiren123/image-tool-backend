const { getClient } = require('./pool');
const logger = require('../utils/logger');

async function withTransaction(callback) {
    const client = await getClient();

    try {
        await client.query('BEGIN');

        const result = await callback(client);

        await client.query('COMMIT');

        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            logger.error('Transaction rollback failed', {
                requestId: null,
                errorCategory: 'DATABASE_TRANSACTION',
                error: rollbackError,
            });
        }

        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    withTransaction,
};
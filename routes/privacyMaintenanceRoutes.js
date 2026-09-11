const express = require('express');
const { query } = require('../db/pool');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/cleanup-ip', async (req, res) => {
    try {
        const cronSecret = process.env.CRON_SECRET;

        if (!cronSecret) {
            logger.error('CRON_SECRET is not configured', {
                requestId: req.requestId,
                errorCategory: 'CONFIGURATION',
            });
            return res.status(500).json({
                success: false,
                error: 'Maintenance job is not configured.',
            });
        }

        const authorization = req.headers.authorization;

        if (authorization !== `Bearer ${cronSecret}`) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized.',
            });
        }

        const result = await query(`
      UPDATE users
         SET ip = NULL
       WHERE ip IS NOT NULL
         AND last_login IS NOT NULL
         AND last_login < NOW() - INTERVAL '90 days'
    `);

        return res.json({
            success: true,
            message: 'IP retention cleanup completed.',
            clearedIpAddresses: result.rowCount,
        });
    } catch (err) {
        logger.error('IP retention cleanup failed', {
            requestId: req.requestId,
            errorCategory: 'MAINTENANCE',
            error: err,
        });

        return res.status(500).json({
            success: false,
            error: 'IP retention cleanup failed.',
        });
    }
});

module.exports = router;
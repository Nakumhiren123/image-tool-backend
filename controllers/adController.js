const { query } = require('../db/pool');
const logger = require('../utils/logger');

const MAX_AD_TITLE_LENGTH = 200;
const MAX_AD_CLIENT_LENGTH = 200;
const MAX_AD_SLOT_LENGTH = 200;

const ALLOWED_AD_FIELDS = new Set([
    'title',
    'position',
    'ad_client',
    'ad_slot',
]);

const ALLOWED_AD_POSITIONS = new Set([
    'leaderboard',
    'skyscraper',
    'rectangle',
    'interstitial',
]);

function hasOnlyAllowedFields(body, allowedFields) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return false;
    }

    return Object.keys(body).every((key) => allowedFields.has(key));
}

function validateAdId(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        return null;
    }

    return id;
}

function validateAdFields(body = {}) {
    const {
        title,
        position,
        ad_client,
        ad_slot,
    } = body;

    if (
        typeof title !== 'string' ||
        !title.trim() ||
        title.trim().length > MAX_AD_TITLE_LENGTH
    ) {
        return {
            error: `Title is required and must be ${MAX_AD_TITLE_LENGTH} characters or fewer.`,
        };
    }

    if (
        typeof position !== 'string' ||
        !ALLOWED_AD_POSITIONS.has(position)
    ) {
        return {
            error: 'Invalid ad position.',
        };
    }

    if (
        ad_client !== undefined &&
        ad_client !== null &&
        (
            typeof ad_client !== 'string' ||
            ad_client.length > MAX_AD_CLIENT_LENGTH
        )
    ) {
        return {
            error: `ad_client must be ${MAX_AD_CLIENT_LENGTH} characters or fewer.`,
        };
    }

    if (
        ad_slot !== undefined &&
        ad_slot !== null &&
        (
            typeof ad_slot !== 'string' ||
            ad_slot.length > MAX_AD_SLOT_LENGTH
        )
    ) {
        return {
            error: `ad_slot must be ${MAX_AD_SLOT_LENGTH} characters or fewer.`,
        };
    }

    return null;
}

/**
 * GET /api/ads
 * Public — frontend fetches all active ads
 */
async function getAds(req, res) {
    try {
        const result = await query(`
      SELECT id, title, position, ad_client, ad_slot
      FROM ads
      WHERE is_active = true
      ORDER BY created_at DESC
    `);
        return res.json({ success: true, ads: result.rows });
    } catch (err) {
        logger.error('Get ads failed', {
            requestId: req.requestId,
            errorCategory: 'DATABASE',
            error: err,
        });

        return res.status(500).json({
            success: false,
            error: 'Could not fetch ads.',
        });
    }
}

/**
 * POST /api/admin/ads
 * Admin only — create new ad
 */
async function createAd(req, res) {
    try {

        if (!hasOnlyAllowedFields(req.body, ALLOWED_AD_FIELDS)) {
            return res.status(400).json({
                success: false,
                error: 'Unexpected request fields.',
            });
        }

        const validationError = validateAdFields(req.body);

        if (validationError) {
            return res.status(400).json({
                success: false,
                error: validationError.error,
            });
        }

        const {
            title,
            position,
            ad_client,
            ad_slot,
        } = req.body;

        const cleanTitle = title.trim();
        const cleanAdClient =
            typeof ad_client === 'string'
                ? ad_client.trim()
                : null;

        const cleanAdSlot =
            typeof ad_slot === 'string'
                ? ad_slot.trim()
                : null;

        const result = await query(`
      INSERT INTO ads (title, position, ad_client, ad_slot, is_active)
      VALUES ($1, $2, $3, $4, true)
      RETURNING *
    `, [
            cleanTitle,
            position,
            cleanAdClient || null,
            cleanAdSlot || null,
        ]);

        return res.json({ success: true, ad: result.rows[0] });
    } catch (err) {
        logger.error('Create ad failed', {
            requestId: req.requestId,
            errorCategory: 'DATABASE',
            error: err,
        });

        return res.status(500).json({
            success: false,
            error: 'Could not create ad.',
        });
    }
}

/**
 * PUT /api/admin/ads/:id
 * Admin only — update existing ad
 */
async function updateAd(req, res) {
    try {
        const id = validateAdId(req.params.id);

        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Invalid ad ID.',
            });
        }

        if (!hasOnlyAllowedFields(req.body, ALLOWED_AD_FIELDS)) {
            return res.status(400).json({
                success: false,
                error: 'Unexpected request fields.',
            });
        }

        const validationError = validateAdFields(req.body);

        if (validationError) {
            return res.status(400).json({
                success: false,
                error: validationError.error,
            });
        }

        const {
            title,
            position,
            ad_client,
            ad_slot,
        } = req.body;

        const cleanTitle = title.trim();

        const cleanAdClient =
            typeof ad_client === 'string'
                ? ad_client.trim()
                : null;

        const cleanAdSlot =
            typeof ad_slot === 'string'
                ? ad_slot.trim()
                : null;

        const result = await query(`
      UPDATE ads
      SET title = $1, position = $2, ad_client = $3, ad_slot = $4, updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [
            cleanTitle,
            position,
            cleanAdClient || null,
            cleanAdSlot || null,
            id,
        ]);

        if (!result.rows[0]) {
            return res.status(404).json({ success: false, error: 'Ad not found.' });
        }

        return res.json({ success: true, ad: result.rows[0] });
    } catch (err) {
        logger.error('Update ad failed', {
            requestId: req.requestId,
            errorCategory: 'DATABASE',
            error: err,
        });

        return res.status(500).json({
            success: false,
            error: 'Could not update ad.',
        });
    }
}

/**
 * DELETE /api/admin/ads/:id
 * Admin only — delete ad
 */
async function deleteAd(req, res) {
    try {
        const id = validateAdId(req.params.id);

        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Invalid ad ID.',
            });
        }

        const result = await query(
            'DELETE FROM ads WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                error: 'Ad not found.',
            });
        }

        return res.json({ success: true, message: 'Ad deleted successfully.' });
    } catch (err) {
        logger.error('Delete ad failed', {
            requestId: req.requestId,
            errorCategory: 'DATABASE',
            error: err,
        });

        return res.status(500).json({
            success: false,
            error: 'Could not delete ad.',
        });
    }
}

/**
 * POST /api/admin/ads/:id/toggle
 * Admin only — enable or disable ad
 */
async function toggleAd(req, res) {
    try {
        const id = validateAdId(req.params.id);

        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Invalid ad ID.',
            });
        }

        const result = await query(`
      UPDATE ads
      SET is_active = NOT is_active, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id]);

        if (!result.rows[0]) {
            return res.status(404).json({ success: false, error: 'Ad not found.' });
        }

        return res.json({
            success: true,
            ad: result.rows[0],
            message: `Ad ${result.rows[0].is_active ? 'enabled' : 'disabled'} successfully.`,
        });
    } catch (err) {
        logger.error('Toggle ad failed', {
            requestId: req.requestId,
            errorCategory: 'DATABASE',
            error: err,
        });

        return res.status(500).json({
            success: false,
            error: 'Could not toggle ad.',
        });
    }
}

module.exports = {
    getAds,
    createAd,
    updateAd,
    deleteAd,
    toggleAd,
};
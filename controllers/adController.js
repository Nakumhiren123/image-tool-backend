const { query } = require('../db/pool');

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
        console.error('GetAds Error:', err);
        return res.status(500).json({ success: false, error: 'Could not fetch ads.' });
    }
}

/**
 * POST /api/admin/ads
 * Admin only — create new ad
 */
async function createAd(req, res) {
    try {
        const { title, position, ad_client, ad_slot } = req.body;

        if (!title || !position) {
            return res.status(400).json({ success: false, error: 'Title and position are required.' });
        }

        const result = await query(`
      INSERT INTO ads (title, position, ad_client, ad_slot, is_active)
      VALUES ($1, $2, $3, $4, true)
      RETURNING *
    `, [title, position, ad_client || null, ad_slot || null]);

        return res.json({ success: true, ad: result.rows[0] });
    } catch (err) {
        console.error('CreateAd Error:', err);
        return res.status(500).json({ success: false, error: 'Could not create ad.' });
    }
}

/**
 * PUT /api/admin/ads/:id
 * Admin only — update existing ad
 */
async function updateAd(req, res) {
    try {
        const { id } = req.params;
        const { title, position, ad_client, ad_slot } = req.body;

        const result = await query(`
      UPDATE ads
      SET title = $1, position = $2, ad_client = $3, ad_slot = $4, updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [title, position, ad_client || null, ad_slot || null, id]);

        if (!result.rows[0]) {
            return res.status(404).json({ success: false, error: 'Ad not found.' });
        }

        return res.json({ success: true, ad: result.rows[0] });
    } catch (err) {
        console.error('UpdateAd Error:', err);
        return res.status(500).json({ success: false, error: 'Could not update ad.' });
    }
}

/**
 * DELETE /api/admin/ads/:id
 * Admin only — delete ad
 */
async function deleteAd(req, res) {
    try {
        const { id } = req.params;

        await query('DELETE FROM ads WHERE id = $1', [id]);

        return res.json({ success: true, message: 'Ad deleted successfully.' });
    } catch (err) {
        console.error('DeleteAd Error:', err);
        return res.status(500).json({ success: false, error: 'Could not delete ad.' });
    }
}

/**
 * POST /api/admin/ads/:id/toggle
 * Admin only — enable or disable ad
 */
async function toggleAd(req, res) {
    try {
        const { id } = req.params;

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
        console.error('ToggleAd Error:', err);
        return res.status(500).json({ success: false, error: 'Could not toggle ad.' });
    }
}

module.exports = {
    getAds,
    createAd,
    updateAd,
    deleteAd,
    toggleAd,
};
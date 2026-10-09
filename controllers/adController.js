const { query } = require('../db/pool');
const logger = require('../utils/logger');

const ALLOWED_POSITIONS = new Set(['leaderboard', 'rectangle', 'skyscraper', 'interstitial']);
const ALLOWED_FIELDS = new Set(['title', 'position', 'ad_client', 'ad_slot']);

function hasOnlyAllowedFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }
  return Object.keys(body).every(key => ALLOWED_FIELDS.has(key));
}

// ── GET /api/ads (Public) ─────────────────────────────────────────────────────
async function getAds(req, res) {
  try {
    const result = await query(
      `SELECT id, title, position, ad_client, ad_slot, is_active FROM ads WHERE is_active = true ORDER BY id ASC`
    );
    return res.status(200).json({
      success: true,
      ads: result.rows,
    });
  } catch (err) {
    logger.error('Failed to fetch ads', { requestId: req.requestId, error: err });
    return res.status(500).json({
      success: false,
      error: 'Unable to fetch ads.',
    });
  }
}

// ── POST /api/admin/ads (Admin) ───────────────────────────────────────────────
async function createAd(req, res) {
  if (!hasOnlyAllowedFields(req.body)) {
    return res.status(400).json({
      success: false,
      error: 'Unexpected request fields.',
    });
  }

  const { title, position, ad_client, ad_slot } = req.body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Title is required.',
    });
  }

  if (title.length > 200) {
    return res.status(400).json({
      success: false,
      error: 'Title exceeds maximum length of 200 characters.',
    });
  }

  if (!position || typeof position !== 'string' || !ALLOWED_POSITIONS.has(position.trim())) {
    return res.status(400).json({
      success: false,
      error: 'Invalid ad position',
    });
  }

  if (ad_client && (typeof ad_client !== 'string' || ad_client.length > 200)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid ad_client.',
    });
  }

  if (ad_slot && (typeof ad_slot !== 'string' || ad_slot.length > 200)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid ad_slot.',
    });
  }

  try {
    const result = await query(
      `INSERT INTO ads (title, position, ad_client, ad_slot, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, NOW(), NOW())
       RETURNING id, title, position, ad_client, ad_slot, is_active, created_at, updated_at`,
      [title.trim(), position.trim(), ad_client ? ad_client.trim() : null, ad_slot ? ad_slot.trim() : null]
    );

    return res.status(201).json({
      success: true,
      ad: result.rows[0],
    });
  } catch (err) {
    logger.error('Failed to create ad', { requestId: req.requestId, error: err });
    return res.status(500).json({
      success: false,
      error: 'Unable to create ad.',
    });
  }
}

// ── PUT /api/admin/ads/:id (Admin) ────────────────────────────────────────────
async function updateAd(req, res) {
  const adId = parseInt(req.params.id, 10);
  if (isNaN(adId) || adId <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid ad ID.',
    });
  }

  if (!hasOnlyAllowedFields(req.body)) {
    return res.status(400).json({
      success: false,
      error: 'Unexpected request fields.',
    });
  }

  const { title, position, ad_client, ad_slot } = req.body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Title is required.',
    });
  }

  if (title.length > 200) {
    return res.status(400).json({
      success: false,
      error: 'Title exceeds maximum length of 200 characters.',
    });
  }

  if (!position || typeof position !== 'string' || !ALLOWED_POSITIONS.has(position.trim())) {
    return res.status(400).json({
      success: false,
      error: 'Invalid ad position',
    });
  }

  if (ad_client && (typeof ad_client !== 'string' || ad_client.length > 200)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid ad_client.',
    });
  }

  if (ad_slot && (typeof ad_slot !== 'string' || ad_slot.length > 200)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid ad_slot.',
    });
  }

  try {
    const result = await query(
      `UPDATE ads
          SET title = $1, position = $2, ad_client = $3, ad_slot = $4, updated_at = NOW()
        WHERE id = $5
        RETURNING id, title, position, ad_client, ad_slot, is_active, created_at, updated_at`,
      [title.trim(), position.trim(), ad_client ? ad_client.trim() : null, ad_slot ? ad_slot.trim() : null, adId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Ad not found.',
      });
    }

    return res.status(200).json({
      success: true,
      ad: result.rows[0],
    });
  } catch (err) {
    logger.error('Failed to update ad', { requestId: req.requestId, error: err });
    return res.status(500).json({
      success: false,
      error: 'Unable to update ad.',
    });
  }
}

// ── DELETE /api/admin/ads/:id (Admin) ─────────────────────────────────────────
async function deleteAd(req, res) {
  const adId = parseInt(req.params.id, 10);
  if (isNaN(adId) || adId <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid ad ID.',
    });
  }

  try {
    const result = await query(
      `DELETE FROM ads WHERE id = $1 RETURNING id`,
      [adId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Ad not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Ad deleted.',
    });
  } catch (err) {
    logger.error('Failed to delete ad', { requestId: req.requestId, error: err });
    return res.status(500).json({
      success: false,
      error: 'Unable to delete ad.',
    });
  }
}

// ── POST /api/admin/ads/:id/toggle (Admin) ────────────────────────────────────
async function toggleAd(req, res) {
  const adId = parseInt(req.params.id, 10);
  if (isNaN(adId) || adId <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid ad ID.',
    });
  }

  try {
    const result = await query(
      `UPDATE ads
          SET is_active = NOT is_active, updated_at = NOW()
        WHERE id = $1
        RETURNING id, title, position, ad_client, ad_slot, is_active, created_at, updated_at`,
      [adId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Ad not found.',
      });
    }

    return res.status(200).json({
      success: true,
      ad: result.rows[0],
    });
  } catch (err) {
    logger.error('Failed to toggle ad status', { requestId: req.requestId, error: err });
    return res.status(500).json({
      success: false,
      error: 'Unable to toggle ad status.',
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
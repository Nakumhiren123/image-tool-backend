const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const {
    getAds,
    createAd,
    updateAd,
    deleteAd,
    toggleAd,
} = require('../controllers/adController');

// ── Public Route (no auth needed) ──
router.get('/ads', getAds);

// ── Admin Only Routes ──
router.post('/admin/ads', requireAdmin, createAd);
router.put('/admin/ads/:id', requireAdmin, updateAd);
router.delete('/admin/ads/:id', requireAdmin, deleteAd);
router.post('/admin/ads/:id/toggle', requireAdmin, toggleAd);

module.exports = router;
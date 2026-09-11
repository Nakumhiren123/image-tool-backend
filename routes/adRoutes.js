const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrfProtection');
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
router.post(
    '/admin/ads',
    requireAdmin,
    csrfProtection,
    createAd
);

router.put(
    '/admin/ads/:id',
    requireAdmin,
    csrfProtection,
    updateAd
);

router.delete(
    '/admin/ads/:id',
    requireAdmin,
    csrfProtection,
    deleteAd
);

router.post(
    '/admin/ads/:id/toggle',
    requireAdmin,
    csrfProtection,
    toggleAd
);
module.exports = router;
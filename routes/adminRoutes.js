const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const {
  getAllUsers,
  updateUserPlan,
  toggleUserAdmin,
  getStats,
} = require('../controllers/adminController');

const {
  csrfProtection
} = require('../middleware/csrfProtection');

// All admin routes require admin authentication
router.use(requireAdmin);

router.get('/users', getAllUsers);
router.post(
  '/users/update-plan',
  csrfProtection,
  updateUserPlan
);

router.post(
  '/users/toggle-admin',
  csrfProtection,
  toggleUserAdmin
);
router.get('/stats', getStats);

module.exports = router;

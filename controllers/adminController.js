const { query } = require('../db/pool');

/**
 * GET /api/admin/users
 * Returns list of all registered users in the platform
 */
async function getAllUsers(req, res) {
  try {
    const result = await query(`
      SELECT 
        id, name, email, browser, os, language, timezone, 
        created_at, last_login, is_pro, is_ad_free, is_admin, 
        plan, subscription_status, expires_at, razorpay_order_id, razorpay_payment_id
      FROM users
      ORDER BY created_at DESC
    `);

    return res.json({
      success: true,
      users: result.rows,
    });
  } catch (err) {
    console.error('Admin GetAllUsers Error:', err);
    return res.status(500).json({ success: false, error: 'Could not fetch user list.' });
  }
}

/**
 * POST /api/admin/users/update-plan
 * Manually grant, extend, or revoke subscription plan for any user
 */
async function updateUserPlan(req, res) {
  try {
    const { userId, plan, days } = req.body;

    if (!userId || !plan) {
      return res.status(400).json({ success: false, error: 'userId and plan are required.' });
    }

    if (plan === 'free') {
      // Downgrade to Free
      await query(`
        UPDATE users
           SET is_pro = false,
               is_ad_free = false,
               plan = 'free',
               subscription_status = 'free',
               expires_at = NULL
         WHERE id = $1
      `, [userId]);

      return res.json({
        success: true,
        message: 'User plan downgraded to Free.',
      });
    }

    // Grant Monthly or Yearly or Custom days
    const durationDays = days || (plan === 'yearly' ? 365 : 30);
    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    await query(`
      UPDATE users
         SET is_pro = true,
             is_ad_free = true,
             plan = $1,
             subscription_status = 'active',
             expires_at = $2,
             pro_plan = $3,
             pro_purchased_at = NOW()
       WHERE id = $4
    `, [plan, expiresAt.toISOString(), `Admin Granted ${plan.toUpperCase()}`, userId]);

    return res.json({
      success: true,
      message: `Successfully updated user subscription to ${plan.toUpperCase()} (active until ${expiresAt.toLocaleDateString()}).`,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('Admin UpdateUserPlan Error:', err);
    return res.status(500).json({ success: false, error: 'Could not update user plan.' });
  }
}

/**
 * POST /api/admin/users/toggle-admin
 * Grant or revoke admin status for a user
 */
async function toggleUserAdmin(req, res) {
  try {
    const { userId, isAdmin } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required.' });
    }

    await query(`
      UPDATE users
         SET is_admin = $1
       WHERE id = $2
    `, [!!isAdmin, userId]);

    return res.json({
      success: true,
      message: `User admin status set to ${!!isAdmin}.`,
    });
  } catch (err) {
    console.error('Admin ToggleUserAdmin Error:', err);
    return res.status(500).json({ success: false, error: 'Could not update admin role.' });
  }
}

/**
 * GET /api/admin/stats
 * Platform overview metrics
 */
async function getStats(req, res) {
  try {
    const totalUsersRes = await query('SELECT COUNT(*) FROM users');
    const proUsersRes = await query('SELECT COUNT(*) FROM users WHERE is_pro = true AND (expires_at IS NULL OR expires_at > NOW())');
    const monthlyRes = await query("SELECT COUNT(*) FROM users WHERE plan = 'monthly' AND is_pro = true");
    const yearlyRes = await query("SELECT COUNT(*) FROM users WHERE plan = 'yearly' AND is_pro = true");

    return res.json({
      success: true,
      stats: {
        totalUsers: parseInt(totalUsersRes.rows[0].count || 0),
        activeProUsers: parseInt(proUsersRes.rows[0].count || 0),
        monthlySubscribers: parseInt(monthlyRes.rows[0].count || 0),
        yearlySubscribers: parseInt(yearlyRes.rows[0].count || 0),
      },
    });
  } catch (err) {
    console.error('Admin GetStats Error:', err);
    return res.status(500).json({ success: false, error: 'Could not fetch admin stats.' });
  }
}

module.exports = {
  getAllUsers,
  updateUserPlan,
  toggleUserAdmin,
  getStats,
};

const { query } = require('../db/pool');
const { withTransaction } = require('../db/transaction');
const logger = require('../utils/logger');

const ALLOWED_UPDATE_PLAN_FIELDS = new Set([
  'userId',
  'plan',
  'days',
]);

const ALLOWED_TOGGLE_ADMIN_FIELDS = new Set([
  'userId',
  'isAdmin',
]);

function hasOnlyAllowedFields(body, allowedFields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }

  return Object.keys(body).every((key) => allowedFields.has(key));
}

/**
 * GET /api/admin/users
 * Returns list of all registered users in the platform
 */
async function getAllUsers(req, res) {
  try {
    const result = await query(`
      SELECT
  id,
  name,
  email,
  browser,
  os,
  language,
  timezone,
  created_at,
  last_login,
  is_pro,
  is_ad_free,
  is_admin,
  plan,
  subscription_status,
  expires_at
FROM users
ORDER BY created_at DESC
    `);

    return res.json({
      success: true,
      users: result.rows,
    });
  } catch (err) {
    logger.error('Admin get all users failed', {
      requestId: req.requestId,
      errorCategory: 'DATABASE',
      error: err,
    });

    return res.status(500).json({
      success: false,
      error: 'Could not fetch user list.',
    });
  }
}

/**
 * POST /api/admin/users/update-plan
 * Manually grant, extend, or revoke subscription plan for any user
 */
async function updateUserPlan(req, res) {
  try {
    if (!hasOnlyAllowedFields(req.body, ALLOWED_UPDATE_PLAN_FIELDS)) {
      return res.status(400).json({
        success: false,
        error: 'Unexpected request fields.',
      });
    }

    const { userId, plan, days } = req.body;
    // ─────────────────────────────────────────────────────────────────────────
    // 1. Validate target user ID
    // ─────────────────────────────────────────────────────────────────────────
    const targetUserId = String(userId || '').trim();

    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!UUID_REGEX.test(targetUserId) || typeof plan !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid userId and plan are required.',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Validate plan
    // ─────────────────────────────────────────────────────────────────────────
    const allowedPlans = new Set([
      'free',
      'monthly',
      'yearly',
    ]);

    if (!allowedPlans.has(plan)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid plan. Allowed plans are free, monthly, and yearly.',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Free plan
    // ─────────────────────────────────────────────────────────────────────────
    if (plan === 'free') {
      const result = await withTransaction(async (client) => {
        return client.query(
          `
      UPDATE users
         SET is_pro = false,
             is_ad_free = false,
             plan = 'free',
             subscription_status = 'free',
             expires_at = NULL,
             pro_plan = NULL,
             pro_purchased_at = NULL
       WHERE id = $1
       RETURNING id
      `,
          [targetUserId]
        );
      });

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found.',
        });
      }

      return res.json({
        success: true,
        message: 'User plan downgraded to Free.',
      });
    }
    // ─────────────────────────────────────────────────────────────────────────
    // 4. Validate custom duration
    // ─────────────────────────────────────────────────────────────────────────
    let durationDays;

    if (days === undefined || days === null || days === '') {
      durationDays = plan === 'yearly' ? 365 : 30;
    } else {
      durationDays = Number(days);

      if (
        !Number.isInteger(durationDays) ||
        durationDays < 1 ||
        durationDays > 3650
      ) {
        return res.status(400).json({
          success: false,
          error: 'Days must be an integer between 1 and 3650.',
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Calculate expiration
    // ─────────────────────────────────────────────────────────────────────────
    const expiresAt = new Date(
      Date.now() + durationDays * 24 * 60 * 60 * 1000
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Grant paid plan
    // ─────────────────────────────────────────────────────────────────────────
    const result = await withTransaction(async (client) => {
      return client.query(
        `
    UPDATE users
       SET is_pro = true,
           is_ad_free = true,
           plan = $1,
           subscription_status = 'active',
           expires_at = $2,
           pro_plan = $3,
           pro_purchased_at = NOW()
     WHERE id = $4
     RETURNING id
    `,
        [
          plan,
          expiresAt.toISOString(),
          `Admin Granted ${plan.toUpperCase()}`,
          targetUserId,
        ]
      );
    });

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found.',
      });
    }

    return res.json({
      success: true,
      message: `Successfully updated user subscription to ${plan.toUpperCase()} (active until ${expiresAt.toLocaleDateString()}).`,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    logger.error('Admin plan update failed', {
      requestId: req.requestId,
      errorCategory: 'ADMIN',
      error: err,
    });

    return res.status(500).json({
      success: false,
      error: 'Could not update user plan.',
    });
  }
}

/**
 * POST /api/admin/users/toggle-admin
 * Grant or revoke admin status for a user.
 *
 * Security:
 * - Only Super Admin can modify admin roles.
 * - Super Admin cannot be demoted.
 * - Last administrator cannot be removed.
 * - Target user ID must be a valid UUID.
 * - Checks and update happen inside one transaction.
 */
async function toggleUserAdmin(req, res) {
  try {
    if (!hasOnlyAllowedFields(req.body, ALLOWED_TOGGLE_ADMIN_FIELDS)) {
      return res.status(400).json({
        success: false,
        error: 'Unexpected request fields.',
      });
    }

    const { userId, isAdmin } = req.body;

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Only Super Admin can change administrator roles
    // ─────────────────────────────────────────────────────────────────────────
    if (req.user?.is_super_admin !== true) {
      return res.status(403).json({
        success: false,
        error: 'Only the Super Admin can modify administrator roles.',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Validate target user UUID
    // ─────────────────────────────────────────────────────────────────────────
    const targetUserId = String(userId || '').trim();

    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!UUID_REGEX.test(targetUserId)) {
      return res.status(400).json({
        success: false,
        error: 'Valid userId is required.',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Validate isAdmin explicitly
    // ─────────────────────────────────────────────────────────────────────────
    if (typeof isAdmin !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'isAdmin must be a boolean.',
      });
    }

    const newAdminStatus = isAdmin;

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Prevent Super Admin from removing their own admin access
    // ─────────────────────────────────────────────────────────────────────────
    if (
      String(targetUserId) === String(req.user.id) &&
      newAdminStatus === false
    ) {
      return res.status(403).json({
        success: false,
        error: 'The Super Admin cannot remove their own admin access.',
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Transaction
    // ─────────────────────────────────────────────────────────────────────────
    const result = await withTransaction(async (client) => {

      // Serialize administrator role changes.
      // Prevents concurrent requests from bypassing last-admin protection.
      await client.query(
        `SELECT pg_advisory_xact_lock($1)`,
        [918273645]
      );

      // Lock the target user and check its current role.
      const targetResult = await client.query(
        `
        SELECT
          id,
          is_admin,
          is_super_admin
        FROM users
        WHERE id = $1
        FOR UPDATE
        `,
        [targetUserId]
      );

      if (targetResult.rowCount === 0) {
        const error = new Error('User not found.');
        error.code = 'USER_NOT_FOUND';
        throw error;
      }

      const targetUser = targetResult.rows[0];

      // ───────────────────────────────────────────────────────────────────────
      // 6. Super Admin is permanently protected from this endpoint
      // ───────────────────────────────────────────────────────────────────────
      if (
        targetUser.is_super_admin === true &&
        newAdminStatus === false
      ) {
        const error = new Error(
          'The Super Admin account cannot be demoted.'
        );

        error.code = 'SUPER_ADMIN_PROTECTED';

        throw error;
      }

      // ───────────────────────────────────────────────────────────────────────
      // 7. Last-admin protection
      // ───────────────────────────────────────────────────────────────────────
      if (
        targetUser.is_admin === true &&
        newAdminStatus === false
      ) {
        const adminCountResult = await client.query(
          `
          SELECT COUNT(*) AS count
          FROM users
          WHERE is_admin = true
          `
        );

        const adminCount = Number(
          adminCountResult.rows[0]?.count || 0
        );

        if (adminCount <= 1) {
          const error = new Error(
            'At least one administrator must remain.'
          );

          error.code = 'LAST_ADMIN';

          throw error;
        }
      }

      // ───────────────────────────────────────────────────────────────────────
      // 8. Update role
      // ───────────────────────────────────────────────────────────────────────
      return client.query(
        `
        UPDATE users
        SET is_admin = $1
        WHERE id = $2
        RETURNING id, is_admin, is_super_admin
        `,
        [newAdminStatus, targetUserId]
      );
    });

    return res.json({
      success: true,
      message: `User admin status set to ${newAdminStatus}.`,
      user: result.rows[0],
    });

  } catch (err) {
    logger.error('Admin toggle user role failed', {
      requestId: req.requestId,
      errorCategory:
        err.code === 'USER_NOT_FOUND' ||
          err.code === 'SUPER_ADMIN_PROTECTED' ||
          err.code === 'LAST_ADMIN'
          ? 'AUTHORIZATION'
          : 'DATABASE',
      error: err,
    });

    if (err.code === 'USER_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'User not found.',
      });
    }

    if (err.code === 'SUPER_ADMIN_PROTECTED') {
      return res.status(403).json({
        success: false,
        error: 'The Super Admin account cannot be demoted.',
      });
    }

    if (err.code === 'LAST_ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'At least one administrator must remain.',
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Could not update admin role.',
    });
  }
}

/**
 * GET /api/admin/stats
 * Platform overview metrics
 */
async function getStats(req, res) {
  try {
    const totalUsersRes = await query(
      'SELECT COUNT(*) FROM users'
    );

    const proUsersRes = await query(`
      SELECT COUNT(*)
      FROM users
      WHERE is_pro = true
        AND (expires_at IS NULL OR expires_at > NOW())
    `);

    const monthlyRes = await query(`
      SELECT COUNT(*)
      FROM users
      WHERE plan = 'monthly'
        AND is_pro = true
    `);

    const yearlyRes = await query(`
      SELECT COUNT(*)
      FROM users
      WHERE plan = 'yearly'
        AND is_pro = true
    `);

    return res.json({
      success: true,
      stats: {
        totalUsers: Number(
          totalUsersRes.rows[0]?.count || 0
        ),
        activeProUsers: Number(
          proUsersRes.rows[0]?.count || 0
        ),
        monthlySubscribers: Number(
          monthlyRes.rows[0]?.count || 0
        ),
        yearlySubscribers: Number(
          yearlyRes.rows[0]?.count || 0
        ),
      },
    });
  } catch (err) {
    logger.error('Admin stats fetch failed', {
      requestId: req.requestId,
      errorCategory: 'DATABASE',
      error: err,
    });

    return res.status(500).json({
      success: false,
      error: 'Could not fetch admin stats.',
    });
  }
}

module.exports = {
  getAllUsers,
  updateUserPlan,
  toggleUserAdmin,
  getStats,
};
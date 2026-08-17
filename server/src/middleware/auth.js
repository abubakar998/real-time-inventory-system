'use strict';

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const config = require('../config/env');
const { unauthorized, forbidden } = require('../lib/errors');

/**
 * Deliberately minimal identity: the client sends `x-user-id` and the server
 * verifies the row exists. That is enough to exercise every inventory rule
 * (ownership of a reservation, one hold per user per drop) without turning the
 * assessment into an auth exercise.
 *
 * Production swap: verify a signed session cookie or JWT here and set
 * `req.user` from its claims. Nothing downstream changes.
 */
async function loadUser(req, _res, next) {
  const raw = req.get('x-user-id');
  const userId = Number.parseInt(raw, 10);

  if (!Number.isFinite(userId)) {
    req.user = null;
    return next();
  }

  try {
    const [user] = await sequelize.query(
      'SELECT id, username FROM users WHERE id = $1',
      { bind: [userId], type: QueryTypes.SELECT }
    );
    req.user = user || null;
    next();
  } catch (error) {
    next(error);
  }
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/**
 * Guards drop creation. If ADMIN_TOKEN is unset the endpoint stays open, which
 * keeps local setup friction-free; set it in any deployed environment.
 */
function requireAdmin(req, _res, next) {
  if (!config.adminToken) return next();
  if (req.get('x-admin-token') === config.adminToken) return next();
  next(forbidden('ADMIN_TOKEN_REQUIRED', 'A valid x-admin-token header is required.'));
}

module.exports = { loadUser, requireAuth, requireAdmin };

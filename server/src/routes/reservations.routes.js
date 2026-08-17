'use strict';

const express = require('express');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const inventory = require('../services/inventory.service');
const expiration = require('../services/expiration.service');
const realtime = require('../realtime');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { badRequest } = require('../lib/errors');

const router = express.Router();

function reservationId(req) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) throw badRequest('INVALID_ID', 'Reservation id must be a number.');
  return id;
}

/** GET /api/reservations/mine — this shopper's recent holds and their outcome. */
router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const reservations = await sequelize.query(
      /* sql */ `
        SELECT r.id,
               r.drop_id    AS "dropId",
               d.name       AS "dropName",
               r.status,
               r.expires_at AS "expiresAt",
               r.created_at AS "createdAt"
        FROM reservations r
        JOIN drops d ON d.id = r.drop_id
        WHERE r.user_id = $1
        ORDER BY r.created_at DESC
        LIMIT 25
      `,
      { bind: [req.user.id], type: QueryTypes.SELECT }
    );

    res.json({ reservations });
  })
);

/** POST /api/reservations/:id/purchase — convert a live hold into a sale. */
router.post(
  '/:id/purchase',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = reservationId(req);

    const { purchase, drop } = await inventory.purchase({ reservationId: id, userId: req.user.id });

    // The unit is sold: its expiry timer is now meaningless.
    expiration.clearTimerFor(id);
    // The broadcast carries both the new stock counts and the refreshed top-3
    // activity feed, so every dashboard updates in one event.
    realtime.broadcastDrop(drop);

    res.status(201).json({ purchase, drop });
  })
);

/** POST /api/reservations/:id/cancel — release a hold early. */
router.post(
  '/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = reservationId(req);

    const { drop } = await inventory.cancel({ reservationId: id, userId: req.user.id });

    expiration.clearTimerFor(id);
    realtime.broadcastDrop(drop);

    res.json({ cancelled: id, drop });
  })
);

module.exports = router;

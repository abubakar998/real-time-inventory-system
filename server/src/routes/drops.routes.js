'use strict';

const express = require('express');
const { z } = require('zod');
const { fn } = require('sequelize');
const config = require('../config/env');
const { Drop } = require('../models');
const dropsQuery = require('../services/drops.query');
const inventory = require('../services/inventory.service');
const expiration = require('../services/expiration.service');
const realtime = require('../realtime');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { notFound, badRequest } = require('../lib/errors');

const router = express.Router();

/**
 * Payload for the "Merch Drop" initialisation API.
 *
 * Stock is initialised as `total_stock` only — `reserved_count` and
 * `sold_count` always start at 0 and are never settable from outside, so the
 * invariant `available = total - reserved - sold` holds from the first row.
 *
 * Timestamps: `startsAt` defaults to now (drop goes live immediately) and may
 * be set in the future to schedule a drop; reservations are rejected before it.
 * `endsAt` is optional — an open-ended drop simply runs until it sells out.
 */
const createDropSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(120),
    description: z.string().trim().max(2000).nullish(),
    imageUrl: z.string().trim().url('Image URL must be a valid URL.').max(2000).nullish().or(z.literal('')),
    priceCents: z.number().int('Price must be whole cents.').min(0).max(100_000_000),
    totalStock: z.number().int().min(1, 'A drop needs at least 1 unit.').max(1_000_000),
    reservationWindowSeconds: z.number().int().min(5).max(3600).optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().nullish(),
  })
  .refine((body) => !body.endsAt || body.endsAt > (body.startsAt ?? new Date()), {
    path: ['endsAt'],
    message: 'endsAt must be after startsAt.',
  });

/** GET /api/drops — dashboard read model (drops + top-3 feed + my hold). */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const drops = await dropsQuery.listDrops({ userId: req.user?.id ?? null });
    res.json({ drops, serverTime: new Date().toISOString() });
  })
);

/** POST /api/drops — initialise a new merch drop. */
router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = createDropSchema.parse(req.body ?? {});

    const created = await Drop.create({
      name: body.name,
      description: body.description || null,
      imageUrl: body.imageUrl || null,
      priceCents: body.priceCents,
      totalStock: body.totalStock,
      reservedCount: 0,
      soldCount: 0,
      reservationWindowSeconds: body.reservationWindowSeconds ?? config.reservationTtlSeconds,
      // `fn('NOW')`, not `new Date()`: "starts immediately" must mean immediate
      // on the *database's* clock. An app server running even a second ahead
      // would otherwise write a starts_at in the database's future, and the
      // drop would reject reservations with DROP_NOT_STARTED until the clocks
      // caught up. (Measured skew against a hosted Postgres here: ~800ms.)
      startsAt: body.startsAt ?? fn('NOW'),
      endsAt: body.endsAt ?? null,
    });

    const drop = await dropsQuery.getPublicDrop(created.id);
    realtime.broadcastDropCreated(drop);

    res.status(201).json({ drop });
  })
);

/** GET /api/drops/:id */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const dropId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(dropId)) throw badRequest('INVALID_ID', 'Drop id must be a number.');

    const drop = await dropsQuery.getDrop(dropId, { userId: req.user?.id ?? null });
    if (!drop) throw notFound('DROP_NOT_FOUND', 'That drop does not exist.');

    res.json({ drop });
  })
);

/** POST /api/drops/:id/reserve — atomically hold one unit for 60 seconds. */
router.post(
  '/:id/reserve',
  requireAuth,
  asyncHandler(async (req, res) => {
    const dropId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(dropId)) throw badRequest('INVALID_ID', 'Drop id must be a number.');

    const { reservation, drop } = await inventory.reserve({ dropId, userId: req.user.id });

    // Arm the low-latency expiry timer, then tell every tab the stock moved.
    expiration.scheduleFor(reservation);
    realtime.broadcastDrop(drop);

    res.status(201).json({ reservation, drop, serverTime: new Date().toISOString() });
  })
);

module.exports = router;

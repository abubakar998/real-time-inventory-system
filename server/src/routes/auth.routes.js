'use strict';

const express = require('express');
const { z } = require('zod');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, 'Username must be at least 2 characters.')
    .max(32, 'Username must be 32 characters or fewer.')
    .regex(/^[\w.-]+$/, 'Use letters, numbers, dots, dashes or underscores only.'),
});

/**
 * POST /api/auth/login
 *
 * Passwordless on purpose (see middleware/auth.js). Get-or-create in a single
 * statement: `ON CONFLICT` on the case-insensitive unique index means two tabs
 * claiming the same name at once still resolve to one row instead of one of
 * them exploding with a duplicate-key error.
 */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username } = loginSchema.parse(req.body ?? {});

    const [user] = await sequelize.query(
      /* sql */ `
        WITH upserted AS (
          INSERT INTO users (username, created_at, updated_at)
          VALUES ($1, now(), now())
          ON CONFLICT (lower(username)) DO UPDATE SET updated_at = now()
          RETURNING id, username, created_at
        )
        SELECT id, username, created_at AS "createdAt" FROM upserted
      `,
      { bind: [username], type: QueryTypes.SELECT }
    );

    res.status(200).json({ user });
  })
);

module.exports = router;

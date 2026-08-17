'use strict';

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * The dashboard read model.
 *
 * One round trip returns every drop *plus* its nested top-3 activity feed and
 * the caller's own live reservation. The feed uses a LATERAL join so Postgres
 * runs a 3-row indexed lookup per drop (purchases_feed_idx) instead of the
 * N+1 queries or the sort-the-whole-table window function a naive version
 * would produce.
 */
const DROPS_SQL = /* sql */ `
  SELECT
    d.id,
    d.name,
    d.description,
    d.image_url                                           AS "imageUrl",
    d.price_cents                                         AS "priceCents",
    d.total_stock                                         AS "totalStock",
    d.reserved_count                                      AS "reservedCount",
    d.sold_count                                          AS "soldCount",
    (d.total_stock - d.reserved_count - d.sold_count)     AS "availableStock",
    d.reservation_window_seconds                          AS "reservationWindowSeconds",
    d.starts_at                                           AS "startsAt",
    d.ends_at                                             AS "endsAt",
    d.created_at                                          AS "createdAt",
    CASE
      WHEN now() < d.starts_at                                     THEN 'scheduled'
      WHEN d.ends_at IS NOT NULL AND now() >= d.ends_at            THEN 'ended'
      WHEN (d.total_stock - d.reserved_count - d.sold_count) <= 0  THEN 'sold_out'
      ELSE 'live'
    END                                                   AS status,
    COALESCE(feed.recent, '[]'::json)                     AS "recentPurchasers",
    mine.reservation                                      AS "myReservation"
  FROM drops d

  -- Top 3 most recent successful purchasers for this drop.
  LEFT JOIN LATERAL (
    SELECT json_agg(row_to_json(latest)) AS recent
    FROM (
      SELECT
        u.id            AS "userId",
        u.username,
        p.created_at    AS "purchasedAt"
      FROM purchases p
      JOIN users u ON u.id = p.user_id
      WHERE p.drop_id = d.id
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 3
    ) latest
  ) feed ON TRUE

  -- The requesting user's own live hold, if any (NULL for anonymous callers).
  LEFT JOIN LATERAL (
    SELECT json_build_object(
             'id',        r.id,
             'expiresAt', r.expires_at,
             'status',    r.status
           ) AS reservation
    FROM reservations r
    WHERE r.drop_id = d.id
      AND r.user_id = $1::int
      AND r.status  = 'active'
      AND r.expires_at > now()
    LIMIT 1
  ) mine ON TRUE

  WHERE ($2::int IS NULL OR d.id = $2::int)
  ORDER BY d.starts_at DESC, d.id DESC
`;

function normalize(row) {
  return {
    ...row,
    // json_agg returns NULL for an empty set even inside COALESCE when the
    // lateral produced no row at all; normalise both shapes to an array.
    recentPurchasers: row.recentPurchasers ?? [],
    myReservation: row.myReservation ?? null,
  };
}

/** Every drop, newest first. `userId` may be null for anonymous requests. */
async function listDrops({ userId = null } = {}) {
  const rows = await sequelize.query(DROPS_SQL, {
    bind: [userId ?? null, null],
    type: QueryTypes.SELECT,
  });
  return rows.map(normalize);
}

/** A single drop in the exact same shape as the list rows. */
async function getDrop(dropId, { userId = null } = {}) {
  const rows = await sequelize.query(DROPS_SQL, {
    bind: [userId ?? null, dropId],
    type: QueryTypes.SELECT,
  });
  return rows.length ? normalize(rows[0]) : null;
}

/**
 * The broadcast shape. Deliberately strips `myReservation` — a WebSocket
 * payload fans out to every connected client, so it must never contain
 * anything scoped to one user.
 */
async function getPublicDrop(dropId) {
  const drop = await getDrop(dropId, { userId: null });
  if (!drop) return null;
  const { myReservation, ...publicDrop } = drop;
  return publicDrop;
}

module.exports = { listDrops, getDrop, getPublicDrop };

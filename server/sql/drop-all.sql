-- Destructive reset used by `npm run db:migrate -- --drop`.
BEGIN;

DROP TABLE IF EXISTS purchases CASCADE;
DROP TABLE IF EXISTS reservations CASCADE;
DROP TABLE IF EXISTS drops CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TYPE  IF EXISTS reservation_status;

COMMIT;

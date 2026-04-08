-- Set DEFAULT 5 on play_threshold and backfill existing NULL rows.
-- The initial schema had DEFAULT 0; we are changing it to 5 to match the
-- product default (exclude artists heard more than 5 times).
ALTER TABLE users
  ALTER COLUMN play_threshold SET DEFAULT 5;

UPDATE users
  SET play_threshold = 5
  WHERE play_threshold IS NULL;

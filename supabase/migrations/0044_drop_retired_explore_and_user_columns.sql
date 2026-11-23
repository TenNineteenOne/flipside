-- 0044 — DESTRUCTIVE, NOT REVERSIBLE. Take a database dump first.
--
-- Drops what no code reads or writes any more (checked against both `main` at
-- a2ef411 and `Nick`, 2026-11-23, so apply order against the deploy does not
-- matter):
--   * explore_cache            — the removed Explore page's cache (#205)
--   * users.last_explore_generated_at — its rebuild cooldown (0040)
--   * users.play_threshold, popularity_curve, underground_mode, deep_discovery,
--     adventurous              — retired by 0042, which folded them into
--                                fame_level; kept one release for rollback
--   * users.flipside_playlist_id, spotify_authorized — left from Spotify sign-in
--
-- After this, rolling the app back to a build from before #205 (2026-11-10) no
-- longer works. Re-runnable (if exists throughout).

drop table if exists explore_cache;

alter table users
  drop column if exists last_explore_generated_at,
  drop column if exists play_threshold,
  drop column if exists popularity_curve,
  drop column if exists underground_mode,
  drop column if exists deep_discovery,
  drop column if exists adventurous,
  drop column if exists flipside_playlist_id,
  drop column if exists spotify_authorized;

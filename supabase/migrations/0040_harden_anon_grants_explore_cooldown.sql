-- 0040 — security hardening (additive, safe to apply before OR after deploy):
--   (1) Revoke the leftover anon Data-API GRANT on every user-facing table, so
--       RLS is no longer the ONLY thing standing between the public browser
--       anon key and the rows. 0036 already did this for `artists`; this extends
--       the same "second lock" to the rest. Supabase auto-grants ALL to anon+
--       authenticated at table creation; we revoke anon's slice everywhere.
--   (2) Add users.last_explore_generated_at to back a per-user cooldown on the
--       expensive (54-74s) explore force-regen path (cost/DoS hardening).
--
-- WHY anon-only (not authenticated): flipside authenticates with NextAuth, never
-- Supabase Auth, so a browser only ever carries the anon publishable key and the
-- server reads via the service-role key (which bypasses grants + RLS). Nothing in
-- the app assumes the `anon` or `authenticated` Postgres role, so revoking anon is
-- a no-op for the app and a real lock against direct PostgREST reads. Verified:
-- no client-side supabase reads exist, and every user-data read goes through a
-- service-role API route.
--
-- Safe ordering: this migration is purely additive. The revokes change nothing the
-- app relies on; the new column is nullable and only read by the new code. Apply it
-- BEFORE deploying the cooldown code (the new code selects the column).

-- (1) Second-lock the user-facing tables (artists already hardened in 0036).
revoke all on table users               from anon;
revoke all on table feedback            from anon;
revoke all on table saves               from anon;
revoke all on table listened_artists    from anon;
revoke all on table recommendation_cache from anon;
revoke all on table seed_artists        from anon;
revoke all on table user_challenges     from anon;
revoke all on table explore_cache       from anon;
revoke all on table login_attempts      from anon;
-- Public artist-data caches: no per-user PII, but revoke anon for a uniform
-- "anon has nothing via the Data API" posture (defense-in-depth; app uses service role).
revoke all on table artist_tracks_cache   from anon;
revoke all on table artist_external_links from anon;
revoke all on table lastfm_cache          from anon;

-- (2) Cooldown timestamp for the explore force-regen path.
alter table users add column if not exists last_explore_generated_at timestamptz;

---
title: Data Model (Supabase)
updated: 2026-11-12
related: [[auth-and-session]], [[generation-engine]], [[api-routes]]
---

# Data Model (Supabase)

Postgres on Supabase, migrations in `supabase/migrations/` (`0001`–`0042`). **All tables
have RLS enabled.** The service-role key bypasses RLS; most privileged writes go through
`createServiceClient()` (see [[auth-and-session]]).

> Artist identity is our own uuid, **`artists.id`** (Stage 2, ADR-0001). Every per-user and
> cross-user artist table keys on `artist_id` (FK → `artists.id`). The legacy
> `spotify_artist_id` columns and `artist_search_cache` were dropped in 0039; the Spotify id
> survives only as the `artists.spotify_id` attribute. See [[spotify-dependency]].

## Core tables

### `artists` — the canonical artist roster (0036)
One row per artist; the only table holding artist metadata. Columns: `id` (uuid PK,
`gen_random_uuid()`), `spotify_id` (text, **unique**, nullable — an attribute),
`mbid` (text, **unique**, nullable — validated-MusicBrainz only, never Last.fm's),
`apple_id`, `deezer_id`, `name`, `name_lower` (**non-unique** — homonyms coexist; always
exactly `lower(name)`), `genres` (text[]), `popularity` (int, nullable), `image_url`,
`artist_color` (lazy-null), `mbid_attempted_at` (0038, the backfill queue),
`created_at`/`updated_at`. Indexes: btree + trigram GIN on `name_lower`; partial
`(mbid_attempted_at nulls first) WHERE spotify_id IS NULL` for the MB backfill.
RLS: authenticated read-only; all writes are service-role.

Rows enter ONLY through the doorway, `lib/artist-identity/` (`ArtistIdentity`): mint by
`spotify_id` (insert-if-absent on the unique key) or, for a bare name, reuse the stable
`name_lower` row (deterministic pick when several exist) / insert a name-only row. Metadata
writes are fill-only (never blank a richer field). Rule set: ADR-0001 decision 2.

### `users` — identity + settings
Originally Spotify-OAuth (0001), pivoted to username-HMAC (0011). Holds identity **and**
all discovery settings.

Key columns: `id` (uuid PK), `username_hash` (unique HMAC), `spotify_id` (legacy, nullable),
`spotify_authorized` (bool), `market`, plus the settings block —
`fame_level` (smallint 0–4, def 2, check-constrained; 0042), `adventurous` (bool, retired; always-on Wander farther, kept for rollback),
`preferred_music_platform` (`spotify`|`apple_music`|`youtube_music`),
`selected_genres` (text[]), encrypted `lastfm_username`/`statsfm_username`, and cooldown
timestamps (`last_generated_at`, `last_accumulated_lastfm_at`,
`last_accumulated_statsfm_at`, `onboarding_completed_at`). See [[settings-and-discovery]].
Retired by 0042 but kept one release for rollback (never read or written by the app):
`play_threshold` (reset to 5 for all rows), `popularity_curve`, `underground_mode`,
`deep_discovery`.

### `listened_artists` — accumulated history
Written by `lib/history/ingest.ts` (`ingestListens`) from Last.fm and stats.fm. Columns:
`user_id`, `artist_id` (uuid FK, nullable until resolved), `lastfm_artist_name` (nullable;
set on name-only rows), `source` (`lastfm`|`statsfm`; legacy rows may carry
`spotify_recent`|`spotify_top`), `play_count`, `last_seen_at`, `id_resolution_attempted_at`.
Unique partial indexes on `(user_id, artist_id) WHERE artist_id IS NOT NULL` and
`(user_id, lastfm_artist_name) WHERE lastfm_artist_name IS NOT NULL AND artist_id IS NULL`
(0041). Play counts bump atomically via `rpc_bump_listened_play_counts` (0041).

### `recommendation_cache` — the Feed queue
Per-user scored queue, unique `(user_id, artist_id)`. Columns: `user_id`, `artist_id`, `artist_data` (jsonb),
`score`, `why` (jsonb: `sourceArtists`, `genres`, `friendBoost`, and `outsideUsual` on
far-pool picks — read back onto `CardArtist.why` by `assembleFeedCards`), `seen_at` (drives 7-day cooldown), `skip_at` (drives 30-day
cooldown / permanent dismiss), `expires_at` (hard TTL), `source`. Hot query uses a partial
index `WHERE seen_at IS NULL` on `(user_id, score DESC, expires_at DESC)`.
RPCs: `rpc_record_feedback_v2`, `rpc_delete_feedback_v2`, `rpc_clear_dismiss_v2` (uuid-keyed, 0036).

### `explore_cache` — retired
The removed Explore page's per-rail cache (`(user_id, rail_key)`, 24h TTL). No code reads or
writes it since 2026-11-10 (#205); a later migration drops it. `users.last_explore_generated_at`
(its 90s rebuild cooldown) is likewise unused.

### `feedback` — thumbs signals
`(user_id, artist_id)` unique, `signal` (`thumbs_up`|`thumbs_down`), soft-delete
via `deleted_at`. Partial index `WHERE deleted_at IS NULL`.

### `saves` — bookmarked artist+track
`spotify_track_id` nullable (0002). Social/group sharing removed in 0010.

### `seed_artists` — onboarding picks
Links a user to explicitly chosen artists (`artist_id`, unique per user); used as cold-start
seeds. Last.fm-only picks get their uuid via `/api/onboarding/resolve` (the doorway).

## Shared caches (cross-user)

| Table | Key | Holds | TTL |
|---|---|---|---|
| `artist_tracks_cache` | `artist_id` (PK, 0037) | track list (iTunes primary / Spotify fallback) | 24h (app-enforced via `fetched_at`) |
| `lastfm_cache` | `(kind, key)` | `tag_top` + `similar` Last.fm responses | 7-day positive, 12h negative |
| `artist_external_links` | `artist_id` (PK, 0037) | resolved `apple_music_url` | 30-day |

## Other tables

- `login_attempts` — IP-hash rate limiting (`rpc_register_login_attempt`, 0035).
- `user_challenges` — weekly discovery quests, `(user_id, week_start, challenge_key)`;
  progress via `rpc_increment_challenge_progress`, called from `rpc_record_feedback` on
  thumbs-up transitions, and by `POST /api/saves` for `save_*` templates. See
  `lib/challenges/engine.ts` (11 rotating templates; [[pages-and-components]] `ChallengeStrip`).
- `groups`, `group_members`, `group_activity` — **legacy** social tables (0001), feature
  removed (0010); tables may still exist but are unused.

## Notes / gotchas

- `underground_mode` (0015) and `deep_discovery` (0022) are retired: folded into
  `fame_level` and `adventurous` by 0042 ([[settings-and-discovery]]); `adventurous` is itself retired.
- `artists.artist_color` is **lazy-null** — populated during generation, not at
  insert; UI must fall back to `#8b5cf6` ([[infra-and-ops]] color extraction).
- **Supabase Data API GRANTs**: newer tables will need explicit GRANTs before the policy
  cutover (defaults 2026-05-30, existing projects 2026-10-30). All writes currently use the
  service-role key, so this is transparent *today*.

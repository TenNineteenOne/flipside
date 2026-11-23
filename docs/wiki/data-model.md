---
title: Data Model (Supabase)
updated: 2026-11-23
related: [[auth-and-session]], [[generation-engine]], [[api-routes]]
---

# Data Model (Supabase)

Postgres on Supabase, migrations in `supabase/migrations/` (`0001`–`0045`; `0043`, `0044` and `0045` are written and tested locally but **not yet applied to production** as of 2026-11-23). **All tables
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
(0041). `play_count` holds the real play count when the source gives one (Last.fm; raised, never lowered), else it bumps by one per sync via `rpc_bump_listened_play_counts` (0041).

### `recommendation_cache` — the Feed queue
Per-user scored queue, unique `(user_id, artist_id)`. Columns: `user_id`, `artist_id`, `artist_data` (jsonb),
`score`, `why` (jsonb: `sourceArtists`, `genres`, `friendBoost`, and `outsideUsual` on
far-pool picks — read back onto `CardArtist.why` by `assembleFeedCards`), `seen_at` (drives 7-day cooldown), `skip_at` (drives 30-day
cooldown / permanent dismiss), `expires_at` (hard TTL), `source`. Hot query uses a partial
index `WHERE seen_at IS NULL` on `(user_id, score DESC, expires_at DESC)`.
RPCs: `rpc_record_feedback_v2`, `rpc_delete_feedback_v2`, `rpc_clear_dismiss_v2` (uuid-keyed, 0036).

Most rows do not live forever. The daily cron (`app/api/cron/recommendations/route.ts`) calls
`rpc_prune_recommendation_cache(p_cutoff)` (migration `0045`, **not yet applied to
production**), which deletes every row whose `expires_at` is more than 30 days in the past
except: rows with `skip_at` set, and **seen** rows whose artist has a live `feedback` row
(`deleted_at` is null) or a `saves` row for that user (#219). Those stay for good, bounded by
the user's likes + passes + saves. Until `0045` is applied the cron deletes nothing from this
table (it logs `prune skipped`), so apply it soon after deploying. History
(`lib/history/query.ts`) reads its list from the seen rows of this table, so an artist that
was only seen or skipped still drops out of History once its row is deleted; one with a
verdict stays. Un-thumbing a like lets the row age out again. Stats
(`app/(app)/stats/stats-data.ts`) also counts seen rows toward Discovered, alongside
`feedback` and `saves`. Saved and the engine's liked-artist seed lookup read artist names
from `artists` by id, so the delete does not reach them.

### `explore_cache` — retired
The removed Explore page's per-rail cache (`(user_id, rail_key)`, 24h TTL). No code reads or
writes it since 2026-11-10 (#205). Migration `0044` drops it, together with
`users.last_explore_generated_at` and the other retired `users` columns (`play_threshold`,
`popularity_curve`, `underground_mode`, `deep_discovery`, `adventurous`,
`flipside_playlist_id`, `spotify_authorized`). `0044` is destructive: dump first.

### `feedback` — thumbs signals
`(user_id, artist_id)` unique, `signal` (`thumbs_up`|`thumbs_down`), soft-delete
via `deleted_at`. Partial index `WHERE deleted_at IS NULL`.

### `saves` — bookmarked artist+track
`spotify_track_id` nullable (0002). Social/group sharing removed in 0010.

### `seed_artists` — onboarding picks
Links a user to explicitly chosen artists (`artist_id`, unique per user); capped at 200 per user
(`lib/api/seed-cap.ts` in the routes, and a `before insert` trigger from `0043` that locks the
user row so two tabs cannot both pass the count; the routes map its `23514` to a 400); used as cold-start
seeds. Last.fm-only picks get their uuid via `/api/onboarding/resolve` (the doorway).

## Shared caches (cross-user)

| Table | Key | Holds | TTL |
|---|---|---|---|
| `artist_tracks_cache` | `artist_id` (PK, 0037) | track list (iTunes; old rows may say `spotify`) | 24h (app-enforced via `fetched_at`) |
| `lastfm_cache` | `(kind, key)` | `tag_top` + `similar` Last.fm responses | 7-day positive, 12h negative |
| `artist_external_links` | `artist_id` (PK, 0037) | resolved `apple_music_url` | 30-day |

## Other tables

- `login_attempts` — IP-hash rate limiting (`rpc_register_login_attempt`, 0035): the 60s
  sign-in buckets, plus one 24h new-account bucket per network (key `sha256("new:<network>")`,
  5 accounts, #218; no schema change). The daily
  cron (`/api/cron/recommendations`) deletes rows whose `window_start` is more than 24 hours old.
- `user_challenges` — weekly discovery quests, `(user_id, week_start, challenge_key)`;
  progress via `rpc_increment_challenge_progress`, called from `rpc_record_feedback` on
  thumbs-up transitions, and by `POST /api/saves` for `save_*` templates. See
  `lib/challenges/engine.ts` (11 rotating templates, picked by calendar week: `ROTATING_KEYS`
  indexed by weeks since 1970-01-05, the same for every user, with no per-user applicability
  check; [[pages-and-components]] `ChallengeStrip`).
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

---
title: Data Model (Supabase)
updated: 2026-06-06
related: [[auth-and-session]], [[generation-engine]], [[api-routes]]
---

# Data Model (Supabase)

Postgres on Supabase, migrations in `supabase/migrations/` (`0001`–`0035`). **All tables
have RLS enabled.** The service-role key bypasses RLS; most privileged writes go through
`createServiceClient()` (see [[auth-and-session]]).

> ⚠️ The **Spotify artist ID** (`spotify_artist_id`) is the de-facto primary key across
> nearly every artist table. This is the single hardest tie to Spotify — see
> [[spotify-dependency]].

## Core tables

### `users` — identity + settings
Originally Spotify-OAuth (0001), pivoted to username-HMAC (0011). Holds identity **and**
all discovery settings.

Key columns: `id` (uuid PK), `username_hash` (unique HMAC), `spotify_id` (legacy, nullable),
`spotify_authorized` (bool), `market`, plus the settings block —
`play_threshold` (int, obscurity), `popularity_curve` (numeric 0.90–1.00),
`underground_mode`, `deep_discovery`, `adventurous` (bools),
`preferred_music_platform` (`spotify`|`apple_music`|`youtube_music`),
`selected_genres` (text[]), encrypted `lastfm_username`/`statsfm_username`, and cooldown
timestamps (`last_generated_at`, `last_accumulated_lastfm_at`,
`last_accumulated_statsfm_at`, `onboarding_completed_at`). See [[settings-and-discovery]].

### `listened_artists` — accumulated history
From all three sources. Columns: `user_id`, `spotify_artist_id` (nullable until resolved),
`lastfm_artist_name` (nullable), `source`
(`spotify_recent`|`spotify_top`|`lastfm`|`statsfm`), `play_count`, `last_seen_at`,
`id_resolution_attempted_at`. Unique on `(user_id, spotify_artist_id)` plus a partial index
on `(user_id, lastfm_artist_name) WHERE spotify_artist_id IS NULL`.

### `recommendation_cache` — the Feed queue
Per-user scored queue. Columns: `user_id`, `spotify_artist_id`, `artist_data` (jsonb),
`score`, `why` (jsonb), `seen_at` (drives 7-day cooldown), `skip_at` (drives 30-day
cooldown / permanent dismiss), `expires_at` (hard TTL), `source`. Hot query uses a partial
index `WHERE seen_at IS NULL` on `(user_id, score DESC, expires_at DESC)`.
RPCs: `rpc_record_feedback`, `rpc_delete_feedback`, `rpc_clear_dismiss`.

### `explore_cache` — the Explore rails
Per-user, per-rail. One row per `(user_id, rail_key)`, **24h TTL**. Deleted on
feedback/seed/genre changes and the Adventurous toggle. See [[explore-engine]].

### `feedback` — thumbs signals
`(user_id, spotify_artist_id)` unique, `signal` (`thumbs_up`|`thumbs_down`), soft-delete
via `deleted_at`. Partial index `WHERE deleted_at IS NULL`.

### `saves` — bookmarked artist+track
`spotify_track_id` nullable (0002). Social/group sharing removed in 0010.

### `seed_artists` — onboarding picks
Links a user to explicitly chosen Spotify artists; used as cold-start seeds.

## Shared caches (cross-user)

| Table | Key | Holds | TTL |
|---|---|---|---|
| `artist_search_cache` | `name_lower` | name → Spotify artist data + `artist_color` (0009) | long; trigram GIN index for ILIKE (0032) |
| `artist_tracks_cache` | `spotify_artist_id` | track list (iTunes primary / Spotify fallback) | 24h (app-enforced via `fetched_at`) |
| `lastfm_cache` | `(kind, key)` | `tag_top` + `similar` Last.fm responses | 7-day positive, 12h negative |
| `artist_external_links` | `spotify_artist_id` | resolved `apple_music_url` | 30-day |

## Other tables

- `login_attempts` — IP-hash rate limiting (`rpc_register_login_attempt`, 0035).
- `user_challenges` — weekly discovery quests, `(user_id, week_start, challenge_key)`;
  progress via `rpc_increment_challenge_progress`, called from `rpc_record_feedback` on
  thumbs-up transitions. See `lib/challenges/engine.ts`.
- `groups`, `group_members`, `group_activity` — **legacy** social tables (0001), feature
  removed (0010); tables may still exist but are unused.

## Notes / gotchas

- `underground_mode` (0015) and `deep_discovery` (0022) are **both** present — confirm
  intended semantics before assuming one supersedes the other ([[settings-and-discovery]]).
- `artist_search_cache.artist_color` is **lazy-null** — populated during generation, not at
  insert; UI must fall back to `#8b5cf6` ([[infra-and-ops]] color extraction).
- **Supabase Data API GRANTs**: newer tables will need explicit GRANTs before the policy
  cutover (defaults 2026-05-30, existing projects 2026-10-30). All writes currently use the
  service-role key, so this is transparent *today*.

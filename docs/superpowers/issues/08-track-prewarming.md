# Issue 08 — Track Pre-warming

**Type:** AFK
**Blocked by:** None — start immediately

## What to build

Ensure that track data for every recommended artist is always a cache hit when the feed loads. Currently, the `/api/artists/[id]/tracks` route may fall through to a live Spotify call. This issue closes that gap and adds pre-warming to the generation step.

### Pre-warming in the generate route

After the final ranked list of artists is produced (and after colour extraction in Issue 06, but this can proceed independently):

1. For each artist in the ranked list, check `artist_tracks_cache` for a fresh entry. An entry is fresh if `fetched_at > NOW() - INTERVAL '24 hours'`.
2. For artists with stale or missing entries, fetch their top tracks from Spotify.
3. Upsert the results to `artist_tracks_cache`.
4. Run fetches in parallel with a concurrency limit of 5 to avoid rate-limit spikes.
5. Only fetch tracks for artists in the **final ranked list** (post-filter, post-sort) — not for every candidate in the pool.

### `/api/artists/[id]/tracks` route hardening

Audit the existing route. It must:
- Read exclusively from `artist_tracks_cache`.
- Never call Spotify or iTunes directly.
- If the cache entry is missing (should not happen post-generation, but possible for artists added via other paths), return `{ tracks: [], cache_miss: true }` rather than making a live call or throwing.
- The `cache_miss: true` flag is for observability only — the client should handle an empty track list gracefully.

### Notes

- The `artist_tracks_cache` table already exists with columns: `spotify_artist_id`, `tracks` (jsonb), `source`, `fetched_at`.
- The existing `lib/recommendation/tracks-handler.ts` may already handle some of this logic — read it before writing new code and extend rather than replace.
- The 24-hour TTL is enforced in application code, not in the database (no row deletion).

## Acceptance criteria

- [ ] After recommendation generation, all ranked artists have a fresh `artist_tracks_cache` entry
- [ ] The `/api/artists/[id]/tracks` route never calls Spotify or iTunes directly
- [ ] A request to `/api/artists/[id]/tracks` for a cached artist resolves in < 100ms (no external calls)
- [ ] A cache miss returns `{ tracks: [], cache_miss: true }` without throwing
- [ ] Pre-warming runs only for final ranked artists, not the full candidate pool
- [ ] Concurrency is limited to 5 parallel Spotify fetches during pre-warming

## Blocked by

None — can start immediately.

## User stories addressed

- Story 59: Track strip shows real track data immediately on feed load (no loading spinners)
- Story 60: Top tracks fetched from Spotify during generation and cached globally
- Story 61: Track cache is shared across all users
- Story 62: Track cache entries have a 24-hour TTL

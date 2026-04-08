# Issue 07 — Last.fm ID Resolution

**Type:** AFK
**Blocked by:** None — start immediately

## What to build

The `listened_artists` table is populated from Last.fm scrobble history, but those rows have `spotify_artist_id = NULL`, making them invisible to the recommendation engine's "already heard" filter. Resolve artist names to Spotify IDs so the filter works correctly for Last.fm listeners.

### Schema change

Add an `id_resolution_attempted_at TIMESTAMPTZ` column to the `listened_artists` table (nullable). This prevents hammering the Spotify search API on every sync for artists that have already been tried and failed.

### Changes to `lib/listened-artists.ts`

After the existing Last.fm upsert step in `accumulateLastFmHistory()`, add a resolution pass:

1. Query `listened_artists` for rows where `spotify_artist_id IS NULL` and (`id_resolution_attempted_at IS NULL` OR `id_resolution_attempted_at < NOW() - INTERVAL '7 days'`).
2. For each unresolved artist name:
   a. Check `artist_search_cache` (lookup by `name_lower`). If found, use the cached `spotify_artist_id` — write it back to `listened_artists`, no Spotify API call needed.
   b. If not in cache, call Spotify's artist search API. On a successful match, upsert the full artist data to `artist_search_cache`, then write the `spotify_artist_id` back to `listened_artists`.
   c. If Spotify returns zero results for the artist name, write the sentinel string `'NOT_FOUND'` to `spotify_artist_id` so this artist is not retried (unless the `7 day` retry window passes).
3. Update `id_resolution_attempted_at` for every row processed, whether resolved or not.

Run name lookups in batches (e.g. 10 at a time) to stay within Spotify rate limits.

### Recommendation engine

No changes needed to the engine itself — it already filters on `spotify_artist_id`. Once IDs are resolved in `listened_artists`, the filter will include Last.fm artists automatically.

### Notes

- Do not resolve `'NOT_FOUND'` rows more often than every 7 days (handled by the timestamp condition above).
- Artist names from Last.fm may differ slightly from Spotify names. Use the first Spotify search result if confidence is high (name similarity > 80%), otherwise skip and mark as `'NOT_FOUND'`.
- The resolution step should be non-blocking for the user — it runs in the background after sync.

## Acceptance criteria

- [ ] `id_resolution_attempted_at` column exists on `listened_artists`
- [ ] After sync, Last.fm artist rows that match artists in `artist_search_cache` have their `spotify_artist_id` filled in
- [ ] After sync, Last.fm artist rows that Spotify can identify have their `spotify_artist_id` filled in and `artist_search_cache` is updated
- [ ] Artists with no Spotify match get `spotify_artist_id = 'NOT_FOUND'` and are not retried for 7 days
- [ ] Already-resolved rows (non-null `spotify_artist_id`) are skipped entirely
- [ ] Unit tests: cache hit → no API call, ID written; cache miss → API called, both tables updated; no Spotify match → sentinel written

## Blocked by

None — can start immediately.

## User stories addressed

- Story 54: Last.fm scrobble history used to filter already-heard artists
- Story 55: Last.fm artist names resolved to Spotify IDs at sync time
- Story 56: `artist_search_cache` used for lookups (no duplicate Spotify calls)
- Story 57: Failed resolutions retried rather than permanently discarded
- Story 58: Last.fm integration status visible in Settings (this is the data side; UI in Issue 15)

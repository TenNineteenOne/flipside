# Flipside — Hardening, Optimization & Feature Gaps PRD

**Date:** 2026-04-18

---

## Problem Statement

After completing the open discovery pivot (username-only auth, multi-path onboarding, genre taxonomy, cold-start engine), a comprehensive 3-agent code review revealed 14 deferred technical issues and 7 feature gaps. The 18 most critical issues were fixed immediately, but the remaining items fall into categories that affect production readiness:

1. **Security:** The auth rate limiter is in-memory and resets on every serverless cold start, providing no real brute-force protection. All API routes use the Supabase service role key, bypassing Row-Level Security. No middleware-level auth guard exists.
2. **Performance:** The listened-artists sync uses N+1 sequential DB queries (400+ round-trips for power users). External API calls have no fetch timeouts. The history API over-fetches data.
3. **Correctness:** The NOT_FOUND sentinel permanently blocks re-resolution of Last.fm artists. The scoring function has arbitrary 4x cliff edges. The recommendation candidate pool is artificially narrow (3 of 50 similar artists used). The MiniPlayer progress bar is hardcoded at 40%. Cold-start seeds are heavily skewed toward ambient/experimental genres.
4. **UX gaps:** No share functionality. No genre filtering on the feed. No discovery stats. No external links to listen on other platforms. No optimistic UI rollback on network failures. No recommendation explainability beyond a truncated subtitle.

Users can discover music today, but the system is fragile under load, has unpolished edges, and lacks features that would make discoveries actionable.

## Solution

Address all 19 remaining items in a single coordinated effort, organized into 5 implementation batches ordered by dependency and efficiency. The changes span security hardening (persistent rate limiter, scoped query helper, auth middleware), performance optimization (batch DB operations, fetch timeouts, pagination), engine improvements (smooth scoring curve, wider candidate pool, diverse cold-start seeds, NOT_FOUND fix), and new features (share button, genre filter with server-side generation, stats page, external Spotify links, visual recommendation explainer, live progress bar, optimistic UI rollback).

## User Stories

**Security**
1. As a user, I want my account protected from brute-force attacks so that no one can guess my username and access my data.
2. As a user, I want the database to enforce that my data is only accessible to me so that even a code bug cannot expose my information to another user.
3. As a user, I want all protected API endpoints to require authentication at the infrastructure level so that no endpoint is accidentally left unprotected.

**Performance**
4. As a user with a large Last.fm history, I want my listening history to sync quickly so that I don't have to wait minutes for it to complete.
5. As a user, I want the app to handle external API slowdowns gracefully so that I get a clear error instead of a frozen screen.
6. As a user with extensive history, I want to scroll through my full discovery history instead of being limited to 100 entries.

**Engine Quality**
7. As a user, I want recommendations scored on a smooth curve so that small popularity differences don't cause large rank swings in my feed.
8. As a user, I want a diverse set of recommendation candidates so that my feed isn't limited by an artificially narrow pool.
9. As a user who skips onboarding, I want cold-start recommendations that span many genres so that I get a fair introduction regardless of my taste.
10. As a user with Last.fm connected, I want artists I've heard to be correctly identified even if they weren't on Spotify during the first resolution attempt.
11. As a user, I want dead code removed from the app so that it runs lean and doesn't allocate unused resources.

**Sharing & External Links**
12. As a user who discovers an artist I love, I want to copy a link to share with friends so that I can spread the discovery.
13. As a user, I want to open a discovered artist directly in Spotify so that I can listen to their full catalog without searching manually.
14. As a user viewing my saved artists, I want a direct link to each artist on Spotify so that saved discoveries are actionable.

**Feed Experience**
15. As a user, I want to filter my feed by genre so that I can focus on a specific mood or style.
16. As a user filtering by genre, I want to generate more recommendations in that specific genre so that the filter always has enough content.
17. As a user, I want to see why each artist was recommended to me so that I can understand and trust the engine's reasoning.
18. As a user, I want visual chips showing which of my liked artists led to a recommendation so that the connection is immediately clear.
19. As a user, I want feedback and save actions to roll back if the API call fails so that I never lose my intent due to a network error.

**Audio & Player**
20. As a user listening to a preview, I want the progress bar to advance in real time so that I know how much of the preview remains.

**Stats & Engagement**
21. As a user, I want a dedicated stats page showing my discovery activity so that I can see my total discoveries, saves, and top genres.
22. As a user, I want the stats page to be easily extensible so that new metrics can be added over time.

**Saves**
23. As a user, I want to know when my save succeeded even if the Spotify playlist addition failed so that I'm not confused by a false error.

**Code Quality**
24. As a developer, I want shared color utility functions extracted into a single module so that bug fixes propagate across all components.
25. As a developer, I want comprehensive tests on all modules with pure logic so that regressions are caught automatically.

## Implementation Decisions

**Auth rate limiter**
- Replace the in-memory `Map` in auth with a Supabase `login_attempts` table
- Schema: `ip_hash TEXT PRIMARY KEY, attempt_count INT, window_start TIMESTAMPTZ`
- Hash the IP (privacy) before storing. Check/increment on each login attempt
- Same 10-attempts-per-60-seconds window as current logic
- Requires a new migration

**Scoped query helper (RLS alternative)**
- Keep using the service role client but create a `scopedQuery(supabase, userId)` helper that returns a chainable builder which always includes `.eq('user_id', userId)`
- Prevents the "forgot the filter" bug without needing Supabase JWT coordination
- Apply to all user-scoped API routes
- Service role remains for cron, engine, and admin operations

**Auth middleware**
- Create `middleware.ts` at project root
- Enforce auth for all `/api/*` routes except `/api/auth/*` and `/api/cron/*`
- Use NextAuth's `auth()` export for session checking
- Return 401 early for unauthenticated requests to protected routes

**Batch listened-artists**
- Refactor `upsertSpotifyArtist()` to batch: single SELECT with `.in('spotify_artist_id', [...allIds])`, partition into inserts vs updates, single `.upsert()` call with `onConflict: 'user_id,spotify_artist_id'`
- Same approach for Last.fm artist upserts
- Reduces 400+ sequential queries to 2-3 batched queries

**NOT_FOUND sentinel removal**
- Stop writing `"NOT_FOUND"` as `spotify_artist_id`. Leave it as `NULL`
- The existing `id_resolution_attempted_at` column + 7-day retry window handles re-resolution timing
- Migrate existing `NOT_FOUND` rows back to `NULL` via a one-time data migration

**Wider candidate slice**
- Change `getSimilarArtistNames` from `slice(start, start + 3)` to `slice(3, 18)`: skip top 3 obvious matches, take next 15
- Downstream scoring and filtering already handle popularity and deduplication

**Smooth scoring curve**
- Replace `tierMultiplier()` step function with `Math.pow(0.95, popularity)`
- At 0.95 base: pop 10 = 0.60x, pop 20 = 0.36x, pop 30 = 0.21x, pop 50 = 0.077x, pop 80 = 0.017x
- Strongly favors obscure artists without arbitrary cliff edges

**Fetch timeouts**
- Add `signal: AbortSignal.timeout(8000)` to `spotifyFetch()` wrapper (single modification point for all Spotify calls)
- Add same timeout to Last.fm fetch calls in the music provider
- Handle `AbortError` in catch blocks with descriptive error messages

**History pagination**
- Add `offset` and `limit` query params to `GET /api/history`
- Filter feedback and saves queries with `.in("spotify_artist_id", seenArtistIds)` instead of fetching all rows
- Add "load more" button to history UI

**Partial-success saves**
- When DB save succeeds but Spotify playlist add fails, return `{ success: true, saved: true, playlistError: "..." }` with 200 status
- Client shows differentiated toast: "Saved!" vs "Saved! (couldn't add to Spotify playlist)"

**Color utils extraction**
- Create shared module with `stringToVibrantHex()` and `hexToRgba()`
- Update imports in 4 component files

**Dead code removal**
- Remove `savedTrackIds`, `resolvingIds`, `handleSaveTrack` from track-strip
- Remove commented-out JSX for track saving
- Remove unused `_tracks` prop from saved-client and the server-side track building in saved/page.tsx

**Live progress bar**
- Add `timeupdate` event listener in AudioProvider
- Expose `progress` (0-1 ratio) from context
- Throttle state updates to avoid excessive re-renders (update every 250ms)
- Wire to mini-player progress bar width

**Genre filter with server-side generation**
- Client: Filter chips derived from unique genres in current recommendations. Hide non-matching cards. Show "X of Y match" count
- Server: Add optional `genre` query param to `/api/recommendations/generate`. Engine filters candidates by genre when specified
- "Generate more [genre]" button at bottom of filtered view

**Stats page**
- New route at `/stats` (inside `(app)` route group)
- Queries: count of seen recommendations, count of saves, count of thumbs-up, count of thumbs-down, top 5 genres by feedback frequency
- Extensible card-based layout for easy addition of new metrics
- Add nav link alongside Feed, History, Saved, Settings

**Share button**
- Copy `open.spotify.com/artist/{id}` to clipboard on tap
- Toast confirmation: "Link copied!"
- Placed alongside existing action buttons on artist cards

**External Spotify links**
- Already present on feed artist cards
- Add to saved page artist grid
- Build as an array of `{ name, icon, url }` objects so adding Apple Music / YouTube Music / Last.fm later is trivial

**Why this artist explainer**
- Expandable panel on artist cards
- Shows source artist avatar chips (small identicon-style) + genre tags
- Tapping a source artist chip has no navigation (just informational)
- Falls back to text when `why.sourceArtists` is empty (cold-start recs)

**Optimistic UI rollback**
- Add try/catch with state rollback to `handleFeedback` and `handleSave` in feed-client
- Show error toast on failure using existing sonner integration
- Follow existing rollback pattern from saved-client

**Cold-start seed diversity**
- Add 20-30 obscure artists (popularity < 20) across pop, rock, R&B, Latin, country, K-pop
- Use Spotify API to verify popularity scores
- Maintain the existing JSON format

## Testing Decisions

Good tests verify external behavior, not implementation details. Tests should not mock internals — they should test inputs and outputs at module boundaries.

Prior art: existing Vitest fixture-based tests in `lib/recommendation/` — follow the same pattern (no live API calls, fixture responses).

**Modules to test:**

1. **Auth rate limiter** — given N login attempts from an IP within a window, assert the (N+1)th is blocked; assert window reset works; assert different IPs are independent
2. **Scoped query helper** — given a user ID, assert all returned query builders include the user_id filter; assert service role operations are not affected
3. **Batch upsert** — given a list of artists (mix of new and existing), assert the batch produces correct inserts and updates; assert conflict resolution works; assert empty input returns gracefully
4. **Scoring curve** — given a range of popularity values (0, 10, 20, 30, 50, 80, 100), assert the smooth curve produces expected multipliers; assert the curve is monotonically decreasing
5. **Color utils** — given a set of artist names, assert deterministic hex color output; assert hexToRgba produces valid RGBA strings
6. **Genre filter logic** — given a list of recommendations with various genres, assert filtering by a specific genre returns only matching items; assert "all" returns everything; assert empty genre list is handled
7. **History pagination** — given offset and limit params, assert correct slice of results; assert feedback/saves are scoped to returned artist IDs only
8. **Stats queries** — given a set of feedback and save records, assert correct counts and genre aggregation
9. **NOT_FOUND migration** — assert existing NOT_FOUND rows are converted to NULL with timestamp preserved
10. **Candidate slice** — given Last.fm responses of various lengths, assert slice(3, 18) returns correct number of candidates; assert short lists (<4 items) return what's available

## Out of Scope

- Full Supabase RLS policies (using scoped query helper instead — true RLS is a future enhancement)
- Upstash Redis or Vercel KV (using Supabase for rate limiting to avoid new dependencies)
- Apple Music, YouTube Music, Last.fm external links (Spotify only for now, built extensibly)
- Custom share page with OG cards (basic clipboard copy for now)
- Server-side rendered stats visualizations (simple count cards)
- Full audio seeking/scrubbing (progress bar is display-only)
- Rate limiting on non-auth API endpoints (auth rate limiter only)
- Spotify Extended Quota Mode application

## Further Notes

- The scoring curve change (`0.95^popularity`) will alter every user's feed ranking. Monitor feedback after deployment.
- The wider candidate slice (3→15) means more Spotify API calls during resolution. Monitor API quota usage.
- The stats page adds a 5th nav item — verify the tabbar layout works well on small screens.
- Cold-start seed curation requires Spotify API access to verify popularity scores. This is a research/curation task, not purely a coding task.
- The scoped query helper is a stepping stone toward true RLS. If the app grows to many users, revisit the RLS decision.

# Issue 04 — Play Threshold: Read from DB + Default to 5

**Type:** AFK
**Blocked by:** None — start immediately

## What to build

The `play_threshold` value is stored in the user's profile but the recommendation-generation route hardcodes `playThreshold: 0`. Wire the real value through and set the default to 5.

### Changes needed

**1. API route (`app/api/recommendations/generate/route.ts`)**

Read `play_threshold` from the authenticated user's profile row. Pass the real value to `buildRecommendations()` instead of the hardcoded `0`.

If `play_threshold` is null (not yet set), default to `5`.

**2. Database migration**

Add a migration that sets `DEFAULT 5` on the `play_threshold` column and backfills any existing `NULL` rows to `5`.

**3. Verify the engine actually uses it**

The `playThreshold` parameter is passed into `buildRecommendations()` / the engine but may not be enforced in the filtering step. Confirm the engine filters out any artist whose listen count exceeds `playThreshold`. If the enforcement is missing or broken, fix it here.

The filter should work like: exclude any artist from `listened_artists` whose play count (or scrobble count) is greater than `playThreshold`. Artists with a null play count pass through (treat unknown as unheard).

### What NOT to change here

- Do not change the Settings UI — that is covered by Issue 15.
- Do not change the popularity weighting — that is covered by Issue 05.

## Acceptance criteria

- [ ] Generating recommendations for a user with `play_threshold = 5` excludes artists they've played more than 5 times
- [ ] Generating recommendations for a user with `play_threshold = 0` excludes artists they've played even once
- [ ] New users default to `play_threshold = 5`
- [ ] The hardcoded `playThreshold: 0` is removed from the generate route
- [ ] Unit tests cover: threshold=0 excludes all heard artists; threshold=100 allows all heard artists through

## Blocked by

None — can start immediately.

## User stories addressed

- Story 50: Play threshold value from Settings is actually used by the engine
- Story 51: Default play threshold is very low (≤ 5)
- Story 52: Artists streamed more than the threshold are excluded
- Story 53: Changing threshold in Settings affects next recommendation refresh

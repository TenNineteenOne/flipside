# PRD — Last.fm deep discovery, play-threshold leak, per-artist stats

**Date**: 2026-04-19
**Branch**: Nick (follow-up to PR #84)
**Author**: TenNineteenOne

## Problem

After shipping PR #84 (round-robin seeds, per-source-seed penalty, underground hard-cap, parallel resolver) the feed is substantially more diverse, but two classes of issue remain:

1. **Last.fm regression-to-the-mean.** `artist.getSimilar` sorts by similarity score, which correlates with popularity. Mainstream seed → mainstream similars. When ALL seeds are mainstream (e.g. a user who thumbs up Drake, Kendrick, Travis Scott repeatedly), round-robin alone can't help — every seed's similar list is popular. The "thumbs-up-popular → more popular" spiral is still possible.

2. **Play-threshold filter leaks familiar artists for Last.fm-only users.** User reports Scary Pockets, bbno$, Lettuce, Sammy Rae landing in the feed despite 11 years of Last.fm scrobble history. Root cause identified: `accumulateLastFmHistory()` at [lib/listened-artists.ts:462-554](lib/listened-artists.ts:462) only pulls the user's **top 200 artists + last 200 tracks** and increments `play_count` by +1 per sync (doesn't import real scrobble counts). Ingestion is also **manual-only** — no auto-sync. A Last.fm user with a 20k-artist long tail loses everything below top-200, and what IS imported may fall below `play_threshold` because plays are under-counted.

3. **No per-artist deep stats for surfaced artists.** User wants a "dig into it" surface where they can see Spotify popularity, Last.fm listener count, personal play count, tag data, and thumb state for every artist the feed has ever shown them. This does *not* belong on the feed card (user explicit ask: "I'm not saying they should see more detailed information in their feed"). Lives on the Stats or History tab.

## Solution overview

Ship in two phases to keep review sizes sane:

- **Phase 1 — backend** (one PR): Problems #1 + #2. Both are Last.fm-side data/engine changes and review naturally together.
- **Phase 2 — UI** (separate PR): Problem #3. Front-end work, independent of Phase 1.

### Phase 1A — Last.fm retrieval diversity (Problem #1)

Attack the regression-to-the-mean **upstream** of scoring.

1. **Larger getSimilar + tail-bias.** Bump `artist.getSimilar` limit from the current 15 (skip-top-3-take-15) to the full 50 per seed. In `buildRoundRobinNames`, interleave the *tail* of each seed's list preferentially — tail results are less-similar (Last.fm sorts by similarity), which empirically correlates with less-mainstream.
   - Interface change: `getSimilarArtistNames(): Promise<string[]>` → `Promise<{ name: string; match: number }[]>`. Last.fm's `getSimilar` response does NOT include `listeners` (that lives in `artist.getInfo` — deferred to Phase 2 where we fetch lazily on sheet-open).
   - `buildRoundRobinNames` gains a `tailFirst: boolean` option. When `true`, iterate each seed's names at index `N-1-i` on cycle `i` so tails are consumed first.
   - The current "skip top-3, take next 15" heuristic is replaced by full 50 + tail bias — a more principled form of the same idea.

2. **"Deep Discovery" user-facing toggle.** New `users.deep_discovery boolean` column, default `false`. When ON:
   - For each seed, take its 3 **lowest-`match`** first-hop similars (furthest from seed's typical neighborhood = likely niche).
   - For each, call `getSimilar` again (2nd hop).
   - Merge 2nd-hop items back under the original seed label — preserves per-source-seed penalty semantics from PR #84.
   - Trade-off: ≤18 extra Last.fm calls per generation (6 seeds × 3 hops). Fired in parallel; Last.fm rate budget easily absorbs it.
   - UI: toggle in Discovery settings card, under "Extra obscure". Copy: "Deep discovery — Walks two artists deep into similar-artist chains. More obscure picks; occasional genre drift."

Listener-count pre-filter from the original PRD draft is **dropped** from Phase 1. Last.fm's `getSimilar` doesn't return `listeners`, and fetching via `artist.getInfo` would mean 300 extra API calls per generation (50 items × 6 seeds) — blows the latency budget. Listener counts are still valuable and will appear in Phase 2's detail surface, fetched on-demand per artist.

### Phase 1B — Last.fm ingestion deepening (Problem #2)

Fix the data at the source so the existing play-threshold filter has something real to filter against.

4. **Full top-artists import.** Change `accumulateLastFmHistory()` at [lib/listened-artists.ts:462](lib/listened-artists.ts:462) to paginate `user.getTopArtists` until exhausted or a reasonable cap (e.g. 2000 — covers most users fully; pathological 11-year collectors may need more but 2k is still a 10× improvement).

5. **Real play-count import.** Last.fm's `user.getTopArtists` response includes `playcount` per artist. Currently we increment by +1 per sync. Replace with *using the Last.fm-provided playcount* directly (overwrite on sync, don't increment). This makes `play_count > threshold` meaningful.

6. **Auto-sync on sign-in for Last.fm-connected users.** When a user signs in and has a `lastfm_username` set, fire a background `accumulateLastFmHistory()` if `last_lastfm_sync_at` is older than 24 hours. Column add: `users.last_lastfm_sync_at timestamp with time zone nullable`. Non-blocking — the UI can proceed while sync runs in `after()`.

7. **Name normalization audit.** With play counts real, spot-check that `normalizeArtistName(row.lastfm_artist_name)` at [engine.ts:206-207](lib/recommendation/engine.ts:206) matches `normalizeArtistName(val.artist.name)` at [:217](lib/recommendation/engine.ts:217) for the user's specific leaked cases (Scary Pockets, bbno$ → bbno$ has a punctuation issue). Fix normalization edge cases if found (add `$` stripping, handle leading "The ", etc.).

### Phase 2 — Per-artist deep stats surface (Problem #3)

Three pieces, decided with user. All share the same underlying data; the surfaces differ in what they emphasize.

**A. Detail sheet (primary mechanic).** Bottom-sheet component that slides up when any artist is tapped outside the Feed (Saved cards, History rows, Stats dot plot is excluded — see C). Shows:
   - Artist image + name
   - **Spotify popularity** (0–100)
   - **Last.fm listener count** (global)
   - **Your Last.fm play count** (personal, from `listened_artists.play_count`)
   - **Top tags** (top 3 Last.fm tags — one more API call per artist, cache aggressively)
   - **Thumb state** (up / down / neutral)
   - **First surfaced** (date the feed first showed this artist)

   Component: `components/artists/detail-sheet.tsx`. Accepts an `artistId` prop; fetches from the new API endpoint on open. Close via swipe-down or backdrop tap.

**B. History tab extended into a list view.** History currently shows feed history as cards (chronological). Extend it into a scrollable, sortable, filterable list:
   - Columns: Artist | Popularity | Your plays | Listeners | Tags | Date | Thumb
   - Filter chips: `Saved` / `Thumbed up` / `All seen`
   - Sort: by popularity, plays, listeners, or date
   - Tap any row → opens sheet A
   - On mobile, the "table" becomes a vertical card list with the same data in a stacked layout (tags as pills, plays/listeners as an inline pair); only Stats columns stay visible.

**C. Popularity dot plot on Stats (visualization only).** Each artist ever surfaced to the user is a dot on a 0–100 popularity axis, jittered vertically to avoid stacking. **Dots are NOT clickable** (explicit user ask — keeps it visually clean, avoids tooltip clutter). Purely a "where do my feeds land?" pattern indicator. Renders alongside the existing saved-artists dot plot (consider grouping under a "Your feed's shape" section).

**Data source for all three:**
- `recommendation_cache.artist_data` — popularity (already present); add `listeners` field when we fetch it during Phase 1A.
- `listened_artists.play_count` — joined by `spotify_artist_id` or normalized `lastfm_artist_name`.
- `feedback` joined for thumb state.
- Last.fm `artist.getInfo` for tags — called lazily on sheet open, cached.
- New column on `recommendation_cache`: `first_surfaced_at timestamp` (set to `created_at` of earliest row for (user, artist); backfill on migration).

## Data model changes

### Phase 1

```sql
-- 001X_users_deep_discovery.sql
alter table users
  add column deep_discovery boolean not null default false;

-- 001Y_users_lastfm_sync.sql
alter table users
  add column last_lastfm_sync_at timestamptz null;
```

### Phase 2

```sql
-- 001Z_recommendation_cache_first_surfaced.sql
alter table recommendation_cache
  add column first_surfaced_at timestamptz null default now();
-- backfill existing rows with created_at as a best-effort substitute
update recommendation_cache
  set first_surfaced_at = coalesce(first_surfaced_at, created_at)
  where first_surfaced_at is null;
```

## API changes

- `app/api/settings/route.ts` PATCH — accept `deepDiscovery: boolean`.
- `app/api/recommendations/generate/route.ts` — read `users.deep_discovery`, pass into `buildRecommendations` input.
- `app/api/history/accumulate/route.ts` (source=lastfm) — pull paginated + import real play counts.
- New: `app/api/artists/surfaced/route.ts` GET — returns enriched surfaced-artist list for Phase 2 page. Pagination required (user may have 500+ surfaced artists over time).

## Engine changes

- `lib/music-provider/provider.ts` — `getSimilarArtistNames()` returns richer structure.
- `lib/recommendation/engine.ts`:
  - `runPipeline` accepts `deepDiscovery` input.
  - `buildRoundRobinNames` gains `tailFirst` option.
  - New: listener-count pre-filter step between Last.fm fetch and Spotify resolve.
  - New: 2nd-hop walk when `deepDiscovery` is true.
- `lib/recommendation/types.ts` — add `deepDiscovery?: boolean` to `RecommendationInput`.

## UI changes

Phase 1:
- `components/settings/settings-form.tsx` (or the Discovery card) — new toggle "Deep discovery" under "Extra obscure". Helper copy.

Phase 2:
- New component: `components/artists/detail-sheet.tsx` — bottom sheet (swipe-down or backdrop to dismiss). Shared by Saved and extended History.
- Extended component: `components/history/history-list.tsx` (or existing equivalent) — becomes a sortable filterable list; cards on mobile, table on desktop. Rows tap-open the detail sheet.
- New component: `components/stats/surfaced-popularity-plot.tsx` — non-interactive dot plot under the existing saved-artists visual. Pure SVG, no hover/tap.
- Saved-card tap handler wired to detail sheet.

## Verification

### Phase 1
- `npx tsc --noEmit`, `npx vitest run` clean.
- Tail-bias unit test: 6 seeds of 50 similars each, with the tail portions artificially tagged low-listener — confirm `buildRoundRobinNames(..., tailFirst=true)` returns low-listener names in the top 60 slots.
- Listener-count pre-filter test: given a mixed candidate list, confirm top 5% listener rows are dropped pre-resolve.
- Deep discovery integration smoke: regenerate with 6 mainstream hip-hop seeds (Drake/Kendrick/Travis/Tyler/Childish/Frank Ocean), k=0.95, `deep_discovery=true`. Expect ≥40% of final 20 at popularity < 50.
- Last.fm ingestion smoke: call `/api/history/accumulate?source=lastfm` for the user, query `listened_artists` — expect (a) Scary Pockets present with realistic play_count matching Last.fm's scrobble count, (b) row count > 200.
- Regenerate feed after re-ingestion — confirm Scary Pockets / bbno$ / Lettuce / Sammy Rae no longer leak.
- Latency budget: cold first-generation with `deep_discovery=true` under 10s (currently ~6s with cap=60).

### Phase 2
- Detail sheet opens within 200ms of tap on a Saved or History item; first paint uses cached popularity/plays; tags stream in when Last.fm responds.
- History filter chips (Saved / Thumbed-up / All seen) correctly scope the list.
- History sorts by popularity / plays / listeners / date — each column works in both directions.
- History mobile layout renders as stacked cards; desktop renders as a real table.
- Stats page shows the surfaced-artists dot plot next to the saved-artists plot. Cursor doesn't change over dots, tapping doesn't do anything (confirmed intentional).
- Pagination on History lazy-loads beyond page 1 for users with many generations.

## Acceptance criteria

**Phase 1:**
- Regenerating with 6 mainstream-only seeds at default settings yields a feed with ≥30% popularity < 50 (vs likely < 10% today).
- With Deep Discovery ON, same seeds yield ≥50% popularity < 50.
- User's Scary Pockets/bbno$/Lettuce/Sammy Rae scenario: after a Last.fm re-ingestion, regenerate excludes all four.
- No latency regression > 2s on cache-warm generations.

**Phase 2:**
- Tapping any artist in Saved or History opens the detail sheet with all six data points (popularity, listener count, your plays, tags, thumb state, first surfaced date) within one API round-trip.
- History tab is filterable by Saved / Thumbed-up / All seen, and sortable by at least popularity + plays + date.
- Stats page renders a non-interactive surfaced-artists dot plot alongside the existing saved-artists plot. Dots are not clickable.
- Feed card copy is unchanged — detail sheet is reachable from Saved / History / Stats only, not from the Feed itself (explicit user ask).

## Risks & mitigations

- **Tail-of-Last.fm picks feel "unrelated"**: spot-check across seed archetypes before shipping. If noticeable, weight the tail bias lighter (e.g. 70% tail / 30% head).
- **Listener-count → Spotify popularity correlation is noisy**: calibrate by sampling 100 artists with both data points and confirming correlation > 0.7 before shipping the pre-filter. If correlation is weaker, make the pre-filter a soft bias instead of a hard drop.
- **Deep Discovery 2nd-hop drift**: if 2nd-hop artists are wildly off-genre, restrict hop 2 to candidates whose Last.fm tags overlap the seed's tags.
- **Last.fm API rate limits on 2000-artist top-list import**: Last.fm allows 5 req/sec authenticated. 2000 artists at limit=200/page = 10 requests — trivial.
- **Surfaced-artists page explosion**: users with many generations may have 1000+ cached artists. Paginate, lazy-load, don't render unnecessary tags on initial load.

## Not in scope / explicitly dropped

- Replacing Last.fm with another similarity provider. (Spotify `/recommendations` was deprecated late 2024; no alternative ships this PR.)
- Rebalancing scoring weights beyond the 80/20 split.
- Adding a popularity ceiling to non-underground mode.
- Showing Last.fm tags on the feed card itself (user explicit ask: keep feed clean).

## Sequencing

1. Write PRD (this doc) — **done**.
2. User review + approval on scope.
3. Create GitHub issues for Phase 1A, 1B, Phase 2 (three issues under a single Milestone).
4. Implement Phase 1 (bundle 1A + 1B) → PR → merge.
5. Implement Phase 2 → PR → merge.

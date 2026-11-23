# PRD — Discovery Settings Redesign + Saved-Artists Popularity View

**Date**: 2026-04-19
**Branch**: Nick
**Author**: TenNineteenOne

## Problem

1. The current `play_threshold` slider is labeled **"How underground?"** — this clashes conceptually with the separate **"Deep underground mode"** toggle below it. They sound like the same control but do unrelated things (one filters already-heard artists, the other bends the popularity curve). Users get confused.
2. The algorithm that ranks artists by obscurity is opaque. We have an algorithm-explainer card on the stats page (built earlier today), but (a) it lives on the wrong page given users want to *tune* the algorithm, not just read about it, and (b) obscurity preference is currently binary (on/off) — no fine-grained control.
3. The stats page should surface something *specific to what the user has saved* — not the same explainer that belongs in Settings.

## Solution overview

### Settings page

1. **Rename** the `play_threshold` slider from "How underground?" → **"How familiar?"** (package #1 from naming discussion). New endpoint labels: `NOTHING FAMILIAR ← → ALL FAMILIAR`. New value labels: "Nothing familiar" / "Mostly new" / "Some favorites" / "All familiar".
2. **Reorder** sections: Profile → **How familiar?** → **Taste anchors** → **Discovery** (new) → Account.
3. **New Discovery section** containing:
   - A new **Popularity preference dial** (continuous, 0–100). Controls the base `k` of the scoring curve `k^popularity`. Endpoints: `NICHE ← → MAINSTREAM`. Value labels at 20/40/60/80 thresholds: "Niche only" / "Mostly niche" / "Balanced" / "Mostly popular" / "Mainstream".
   - The **Extra obscure toggle** (moved from its current standalone section into Discovery). It keeps its existing independent job — applies a `((100-pop)/100)^2` multiplier *on top* of the curve.
   - A **live curve preview** that redraws in real time as the dial moves and the toggle flips. Both the curve shape (`k^pop`) and the dashed underground overlay (`k^pop × ((100-pop)/100)^2`) animate accurately.
   - **Four anchor dots** at popularity 0, 30, 70, 100 with *distinct* example artists drawn from the user's own feed (nearest-match but deduplicated).

### Stats page

4. **Remove** the algorithm-explainer card and the 5-bucket feed-popularity histogram (both move to Settings, merged into the live curve preview).
5. **Add** a **"Your saved artists"** visualization:
   - **Dot plot** along a 0–100 popularity axis: each saved artist renders as a dot (jittered vertically to avoid stacking). Tap/hover shows the artist name.
   - **Table** below: columns `Artist | Popularity | Tier`. Tier maps to the five popularity buckets. Sortable by popularity.
   - Data source: `saves` table joined to `recommendation_cache.artist_data` (or `artist_search_cache`) for popularity values.

## Data model changes

New column:

```sql
alter table users
  add column popularity_curve numeric(4,3) not null default 0.95
  check (popularity_curve >= 0.90 and popularity_curve <= 1.00);
```

- Range **0.90 – 1.00**. Smaller = steeper curve (strong obscurity preference). Larger = flatter (popularity barely matters).
- Default **0.95** (matches the current hardcoded value in the engine — zero behavior change for existing users).
- Stored with 3 decimals (0.901 … 1.000), so the slider has ~100 distinct positions.

Migration file: `0018_users_popularity_curve.sql`.

## API changes

- `app/api/settings/route.ts` PATCH handler: accept `popularityCurve: number`. Validate `0.90 ≤ value ≤ 1.00`. Map to `users.popularity_curve`.
- `app/api/recommendations/generate/route.ts`: read `users.popularity_curve` (default 0.95) and pass into `buildRecommendations` input.

## Engine changes

- `lib/recommendation/types.ts`: add `popularityCurve: number` to `RecommendationInput`.
- `lib/recommendation/engine.ts`: replace hardcoded `Math.pow(0.95, popularity)` with `Math.pow(popularityCurve, popularity)`.
- The underground_mode `((100-pop)/100)^2` penalty **remains independent and unchanged** — it multiplies on top of the curve, same as today.

## UI components

- **New**: `components/settings/popularity-dial.tsx` — continuous range input styled like the existing familiarity slider.
- **New**: `components/settings/curve-preview.tsx` — client-side SVG. Takes `{ popularityCurve, undergroundMode, exampleArtists }` as props, redraws on prop change. Reuses the SVG math from today's `AlgorithmExplainerCard` but parameterized by `k` and extended to 4 anchors.
- **New**: `components/stats/saved-popularity-view.tsx` — dot plot + table. Takes `{ savedArtists: { name, popularity }[] }`.
- **Modified**: `components/settings/settings-form.tsx` — reorder sections, rename slider, absorb the "Extra obscure" toggle and the new dial into a single Discovery card.
- **Modified**: `components/stats/stats-client.tsx` — remove `PopularityHistogramCard` and `AlgorithmExplainerCard`, add `<SavedPopularityView>`.
- **Modified**: `app/(app)/stats/page.tsx` — drop the histogram+anchor queries (no longer needed), add a query for saved-artists-with-popularity.

## Acceptance criteria

- [ ] Settings page renders with new section order: Profile → How familiar? → Taste anchors → Discovery → Account.
- [ ] "How familiar?" slider shows new title + endpoint labels + value labels. Saving still updates `users.play_threshold`.
- [ ] Discovery section contains: popularity dial, Extra obscure toggle, live curve preview with 4 anchor dots.
- [ ] Dragging the popularity dial re-renders the curve live without a network round-trip. Saving on release persists `users.popularity_curve`.
- [ ] Toggling "Extra obscure" live-redraws the dashed overlay on the curve.
- [ ] Each of the 4 anchor dots shows a distinct artist name (from user's cache, nearest-match with dedup). Fallback text if the user has no recs yet.
- [ ] Stats page no longer shows the histogram or algorithm-explainer cards.
- [ ] Stats page shows saved-artists dot plot + sortable table. Empty state when user has 0 saves.
- [ ] Generating recommendations uses the user's `popularity_curve` value (observable in the scoring formula).
- [ ] All 466 existing tests still pass. `npx tsc --noEmit` clean.

## Rollout order

1. **Migration** — add `users.popularity_curve` column. Deploy-safe because existing code still references the hardcoded 0.95 at this point.
2. **Engine + types** — plumb `popularityCurve` through `RecommendationInput`, read from users table in generate route. Behavior unchanged (default 0.95 matches hardcoded).
3. **Settings API** — add `popularityCurve` field to PATCH handler.
4. **Settings UI** — rename slider, reorder sections, add Discovery card with dial + toggle + live curve preview.
5. **Stats page** — remove old cards, add saved-artists view.
6. **Verify** — typecheck + tests + preview smoke test of both pages.

## Out of scope

- Onboarding changes (the new dial is Settings-only for now; new users get default 0.95).
- Progress bar for cold-start generation (previously deferred per earlier plan; still deferred).
- Genre-based filters for the curve.
- Modifying the `((100-pop)/100)^2` underground penalty formula itself (user confirmed toggle stays independent of the dial).

## Open questions

None remaining — all clarifying questions resolved in the design conversation.

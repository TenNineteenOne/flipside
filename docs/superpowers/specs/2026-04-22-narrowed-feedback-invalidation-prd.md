# PRD — Narrowed Feedback Invalidation (Phase 5 of Explore perf)

**Date**: 2026-04-22
**Branch**: Nick
**Author**: TenNineteenOne

## Problem

Every thumbs-up or thumbs-down on any Explore card wipes all 4 cached rails for the user, forcing the next `/explore` visit to rebuild cold. That's ~500–2000ms of needless recompute every time a user reacts to a card.

Worse, it punishes the exact behavior the app is trying to encourage — users who actively curate their feed pay a bigger perf tax than users who don't.

## Behavior model — hard + soft

Feedback should be applied in two layers:

**Hard** — the rail the action happened in.
The user just interacted with that specific picks set. They saw these exact cards, they reacted to one of them, and they expect the rest of *that rail* to respond. Invalidate that rail now so its next visit reflects the signal immediately.

**Soft** — every other rail.
The signal is still informative for the user's broader taste graph. A thumbs-up on a Left-field artist still says "I liked this," and that should feed Adjacent / Wildcards / Outside too — but not as an immediate invalidation. The existing `feedback` table row persists; the next time those other rails' 24h TTL expires, they rebuild using the updated feedback corpus and pick up the signal naturally.

Mechanically, "soft apply" is **not a new code path** — it's the existing pipeline doing its work once we stop the full wipe. The feedback row is already being written; today's wipe just hides the fact that we're immediately rebuilding everything.

## Decision table

Actions are filed under the rail the card was displayed in at the moment of the action.

| Signal | Origin rail | Hard invalidate | Soft (feedback row → next TTL rebuild) |
|---|---|---|---|
| thumbs_up | any | origin rail only | all other rails pick it up on natural expiry |
| thumbs_down | any | origin rail only | all other rails pick it up on natural expiry |
| save | any | nothing | saves don't currently feed rail composition — no-op either way |
| dismiss | any | nothing | already local-only today |
| seed change (Settings) | — | all rails | existing behavior, unchanged |
| selected_genres change | — | all rails | existing behavior, unchanged |
| Adventurous toggle | — | all rails | existing behavior, unchanged |

**Why thumbs_down isn't wider-hard than thumbs_up**: a downvote in Wildcards and an upvote in Wildcards are symmetric user actions on the same rail — neither one says "please force-rebuild my Adjacent rail right now." Both say "update the taste signal for next time." Symmetric treatment is simpler and defensible.

## Data model changes

**None.** `explore_cache` already has `UNIQUE (user_id, rail_key)` — per-rail invalidation is a one-line filter on the existing delete.

## Engine changes

`lib/recommendation/explore-engine.ts:890` — extend the signature:

```ts
export async function invalidateExploreCache(
  userId: string,
  rails?: RailKey[],   // omitted → invalidate all (current behavior)
): Promise<void>
```

When `rails` is provided, the delete becomes `.in('rail_key', rails)`. When omitted, falls back to today's delete-all.

This keeps all existing callers (Settings PATCH, seed-artists PATCH, Saves — the ones that legitimately need a full wipe) working unchanged, and lets the feedback route opt into narrowed invalidation.

**Why preserve the full-wipe default**: callers that change the user's settings (seeds, genres, Adventurous) genuinely invalidate the entire taste model. Defaulting to full-wipe is safer than forcing every caller to enumerate rails.

## API changes

`app/api/feedback/route.ts` — accept an optional `railKey` field on the POST body:

```ts
const RAIL_KEYS = ["adjacent", "outside", "wildcards", "leftfield"] as const
type RailKey = typeof RAIL_KEYS[number]

body: { spotifyArtistId: string; signal: string; railKey?: RailKey }
```

Validation: if `railKey` is present, it must be one of the four known values (reject anything else as 400). If absent, fall back to today's full-wipe (so legacy clients keep working during the rollout window).

On `thumbs_up` / `thumbs_down`:
- `railKey` provided → `invalidateExploreCache(userId, [railKey])`
- `railKey` omitted → `invalidateExploreCache(userId)` (full wipe, current behavior)

`skip` continues to skip invalidation entirely.

## UI changes

`components/explore/explore-client.tsx:handleFeedback` — the handler already has `activeRail.railKey` in scope via the `ExploreArtistRow` component. Thread the active rail key through to the API call:

```ts
body: JSON.stringify({ spotifyArtistId: artistId, signal, railKey: activeKey }),
```

No visual change. No behavioral change from the user's perspective beyond "the app feels snappier after I react to a card."

Feed and other surfaces that call `/api/feedback` do not send `railKey` and continue to trigger the full-wipe fallback (correct — a Feed thumbs-up wasn't filed under any particular Explore rail).

## Performance impact (expected)

- **Today**: thumbs-up on any card → 4 rails rebuilt cold on next `/explore` visit (~500–2000ms).
- **After**: thumbs-up on any card → 1 rail rebuilt cold, 3 served from cache (~150–500ms).
- Plus all the Phase 1–4 wins stack on top.

Net perceived effect: curating your feed stops feeling punitive.

## Safety — how soft signal actually propagates

The premise of this design hinges on "the feedback row reaches other rails at their next natural rebuild." Verifying:

- `lib/recommendation/explore-engine.ts:loadUserContext` already reads the `feedback` table for thumbs-up'd seed names — so Wildcards rebuilds pick up any thumbs-up regardless of which rail it came from.
- Filter-side rails (Adjacent / Outside / Left-field) read thumbs-down'd IDs via the shared `seen_at` gate in `lib/recommendation/engine.ts` — same story: the signal is in the feedback table, the next rebuild reads it.

So soft apply is real, not vaporware: the signal reaches every rail, just at their own TTL cadence rather than instantly.

## Rollout

Single PR, behind no flag. Low risk because:
1. The engine change is additive (new optional param, old behavior preserved).
2. The API change is additive (optional field, old body shape still works).
3. UI change is one line in one file.

## Decisions confirmed

1. **Symmetric thumbs-up vs thumbs-down** — ✅ both narrow-invalidate only the origin rail. Soft propagation handles the rest. User confirmed 2026-04-22 with the explicit requirement that "decisions must still be taken into account on future feed generations" — which is already guaranteed by the persistence model (see Safety section above).
2. **Legacy client fallback** — ✅ keep it. Feedback posts without `railKey` fall back to the existing full-wipe. This covers Feed thumbs-ups (which genuinely should invalidate all of Explore — different context, no rail origin) and any future non-Explore callers. Confirmed 2026-04-22.
3. **Save invalidation** — ✅ stays as today (no-op). Confirmed 2026-04-22. Parked as a future consideration: whether a save should count as a positive taste signal for future rail generations belongs in its own small PRD, since it's a taste-model change rather than a perf change.

## Non-goals

- Cross-rail "soft active refresh" (background job that proactively rebuilds other rails after a signal). Overengineered — natural TTL is sufficient.
- Per-action telemetry on which rail drove which save. Out of scope for this perf phase.
- Changing Feed's feedback → invalidation behavior. Feed has its own `recommendation_cache` model; this PRD is scoped to Explore.

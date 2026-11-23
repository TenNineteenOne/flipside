# PRD: Recommendation Diversity Overhaul

**Status:** Drafted 2026-04-24 · Awaiting implementation
**Related:** Shipped near-term nudge in [apps#114](https://github.com/TenNineteenOne/flipside/pull/114) (bumped `greedyPickTop` weights 0.05→0.10 / 0.04→0.08). This PRD covers the full overhaul.

---

## Problem

A user who likes several artists in one session (e.g. liking 5 J-rock artists) risks their feed collapsing into a single-genre echo chamber. The recent soft diversity nudge (`genreWeight = 0.10`) helps on a homogeneous pool but doesn't address:

- Feed and Explore both use **all thumbs-up artists as seeds** every request. The more a user likes, the more a dominant cluster self-reinforces — even a soft penalty can't break out when most seeds point to the same genre.
- Explore's 4 rails each independently pick candidates; there's no cross-rail budget. A cluster can occupy meaningful shares of every rail.
- No surface-level guarantee of "fresh air" — when a user's taste is narrow, the whole 80-item Explore page stays narrow.

## North Star

Likes are a **quiet signal**: they nudge, never dominate. The user's taste is represented without flooding the surface.

## Decisions (locked)

| # | Decision | Value |
|---|---|---|
| 1 | Cluster definition | Primary genre — `artist.genres[0]` |
| 2 | Cluster cap | 25% of visible surface (Feed: 5/20, Explore: 20/80) |
| 3 | Exploration budget — baseline | 20% of visible surface |
| 4 | Exploration budget — Adventurous ON | 50% of visible surface |
| 5 | Like scoring | **No boost** — likes only affect pool membership (no multiplier) |
| 6 | Rolling like sample | 10 random likes per request |

## Non-goals

- **No scoring boost from likes.** The audit confirms likes already only affect pool membership via seed assembly — no `likeBoost` multiplier exists. This PRD *preserves* that shape and does not add one.
- **No new user-facing toggles.** Exploration budget piggybacks on the existing Adventurous toggle.
- **No schema changes.** `feedback`, `recommendation_cache`, `explore_cache` all stay as-is.
- **No new tables or RPC surface.**
- **No change to Dismiss / skip_at / Feed cooldown.** Shipped in 114.

---

## Current state (from codebase audit)

- **Feed seed assembly** ([lib/recommendation/engine.ts:87](lib/recommendation/engine.ts#L87) `gatherSeedContext`) already `limit(10)` on thumbs-up but **fetches the 10 most recent**, not a random sample. Rolling sample is a single-line diff here.
- **Explore seed assembly** ([lib/recommendation/explore-engine.ts:143](lib/recommendation/explore-engine.ts#L143) `loadUserContext`) fetches **ALL** thumbs-up IDs, no limit. `wildcardsRail` uses every like. This is where the rolling sample bites.
- **Greedy-pick** ([engine.ts:240](lib/recommendation/engine.ts#L240)) applies `genreWeight` and `sourceWeight` soft penalties but **no hard cap**. Feed-only; Explore doesn't call it.
- **Explore rail composition** ([explore-engine.ts:862](lib/recommendation/explore-engine.ts#L862) `buildExploreRails`) runs 4 rails in parallel via `Promise.allSettled`, no cross-rail cluster tracking.
- **Exploration pool today:** Feed's `augmentWithAdjacent` injects 2 (non-adv) or 4 (adv) picks at positions ≥5. Explore's `leftfieldRail` is already unbiased (uniform tag sampling, no thumbs-up input) — it's the closest thing to an exploration rail, currently 10 of 80 slots (12.5%).
- **Explore cache** ([explore-engine.ts:968](lib/recommendation/explore-engine.ts#L968)) keys on `(user_id, rail_key)` with 24h TTL + weekly `cacheWindowSeed`. Rolling sample at request time conflicts with stable cache — resolved by seeding the sample with the cache window, not fresh randomness.
- **No like-scoring boost exists today.** The "pool-only, no boost" decision is a confirmation of current behavior, not a removal.

---

## Target state

### Shared pipeline changes

- **Seed assembly** draws a deterministic rolling sample of 10 likes per request, seeded by `cacheWindowSeed(userId, 'like-sample')` so the sample is stable across cache hits within the window but rotates when the window rolls or the cache is invalidated.
- **Cluster tracking** is attached to the final visible set (post-composition). Any pick whose `artist.genres[0]` count would exceed the 25% cap is swapped for the next-best non-over-budget candidate from the same rail's leftover pool. If no swap is possible (pool exhausted), leave the pick and log a diagnostic.
- **Exploration budget** is reserved *before* the biased pipeline runs. For a 20-slot Feed at 20%, slots 1–16 go to the biased pipeline and 4 slots are held for leftfield/adjacent-unbiased picks. For Explore's 80 slots, 16 (20%) or 40 (50% adv) come from the unbiased pool.

### Feed (20 items per page)

- **Biased pool** shrinks from full 20 to 16 (baseline) or 10 (adv).
- **Unbiased pool** grows from `augmentWithAdjacent`'s 2/4 to 4/10 picks.
- Cluster cap: max 5 of 20 (25%) from any `genres[0]`.

### Explore (4 rails × 20 slots = 80 items)

- **Baseline:** rail sizes stay as today (~10 each, adventurous bumps to ~12). Leftfield's existing ~12.5% share is *already* below the 20% target — bump its target from 10 to **16** so leftfield represents a clean 20% of visible Explore. Total becomes 10+10+10+16 = 46 before topup, up to ~60 after floor-topup.
- **Adventurous:** leftfield target grows to **40**; other 3 rails stay at adventurous targets (12 each). Leftfield becomes half the visible Explore. Total becomes 12+12+12+40 = 76.
- Cross-rail cluster cap: max 25% of the *total rendered* slots share a `genres[0]`. Enforced in `buildExploreRails` after `Promise.allSettled` returns but before cache upsert. Over-budget picks get swapped for under-budget leftovers from the same rail's pool.

### Adventurous toggle semantics (cumulative)

| Behavior | Today | After overhaul |
|---|---|---|
| `AFTERHOURS_TARGET` | 10 → 12 | unchanged |
| `OUTSIDE_TARGET` | 10 → 12 | unchanged |
| `WILDCARDS_TARGET` | 10 → 12 | unchanged |
| `LEFTFIELD_TARGET` | 10 → 12 | **10 → 16 baseline, 12 → 40 adv** |
| `ADVENTUROUS_MAINSTREAM_PENALTY` | 0.08 | unchanged |
| Feed `augmentWithAdjacent` N | 2 / 4 | **4 / 10** |
| Feed biased pool size | 20 | **20 / 16 / 10** (baseline Feed / budget baseline / adv) |

---

## Milestones

### M1 — Rolling like sample (small, low risk)

**Scope:** Replace "all likes" / "10 most recent" with "deterministic random sample of 10" in both engines.

**Changes:**
- `engine.ts:gatherSeedContext` — replace `.order('created_at', { ascending: false }).limit(10)` with a fetch-all + seeded-shuffle + slice(10). Seed = `cacheWindowSeed(userId, 'like-sample')`.
- `explore-engine.ts:loadUserContext` — same treatment; tag as `thumbsUpIds = Set<string>` of the sampled 10, not all.
- `wildcardsRail` now operates on the sampled set (no code change; reads from `thumbsUpIds`).
- Tests: seed assembly tests in `engine.test.ts` need new assertions that sample size ≤ 10 and is deterministic per cache window.

**Risks:** Users with <10 likes see no behavior change (still use all). Users with 10–30 likes see variety per window. Users with 50+ likes may notice specific niches disappear for a window.

### M2 — Cluster cap (25% by primary genre)

**Scope:** Hard post-composition cap on visible share of any primary genre, in Feed and across Explore.

**Feed changes:**
- After `greedyPickTop(pool, 20)` at [engine.ts:607](lib/recommendation/engine.ts#L607), add a `applyClusterCap(top, 0.25, leftover)` helper that walks the top-20, counts `genres[0]`, and when any genre exceeds 5 slots, swaps the lowest-scoring over-budget pick for the highest-scoring under-budget leftover.
- Hook into Feed augmentation path similarly: adjacent injections must not push any genre over the cap.

**Explore changes:**
- New helper `enforceCrossRailBudget(rails, totalTarget, capPct)` called inside `buildExploreRails` after `Promise.allSettled` but before cache upsert. Walks all rendered picks by descending score, admits while under-cap, and for over-cap picks pulls next-best from the same rail's leftover pool.
- `RailResult` needs a `leftover: ScoredArtist[]` field (or similar) so the budget-enforcer has somewhere to swap in from. Each rail already resolves more names than it picks — the residue becomes `leftover`.

**Tests:**
- `engine.test.ts` — new "enforces 25% cap on homogeneous pool" case.
- New `explore-engine.test.ts` coverage for `enforceCrossRailBudget`.

### M3 — Exploration budget (20% / 50%)

**Scope:** Reserve visible share for unbiased picks.

**Feed changes:**
- Bump `augmentWithAdjacent` injection count: non-adventurous N=4, adventurous N=10. Constants at [engine.ts:322–327](lib/recommendation/engine.ts#L322).
- Biased greedy-pick reduces to `20 - N` slots so the final page is `biased + unbiased = 20`.
- Position constraint stays (injections at ≥5, or ≥3 adventurous).

**Explore changes:**
- `LEFTFIELD_TARGET`: 10 → 16 (baseline), 12 → 40 (adventurous). Constants at [explore-engine.ts:663–664](lib/recommendation/explore-engine.ts#L663).
- `LEFTFIELD_PICKS_PER_TAG` probably needs to scale to supply enough candidates for 40. Audit says current is 8 / 10 — may need 12–14 for adv.

**Cache implications:**
- Bumping `LEFTFIELD_TARGET` changes the cached rail shape. The next deploy invalidates the explore cache naturally via `invalidateExploreCache` on any write. Optionally, bump the cache key version to force invalidation for existing users.

**Tests:**
- `augmentWithAdjacent` tests need updates for new N.
- Leftfield rail test needs updated target expectations.

### M4 — Tests, telemetry, cleanup

**Scope:** Round out test coverage; add diagnostic logging; remove the temporary `greedyPickTop` weight bump rationale comment at [engine.ts:232–239](lib/recommendation/engine.ts#L232).

**Telemetry (optional, logging only — no new tables):**
- Log cluster distribution post-cap in Feed: `"cluster-cap: %o"` with `{ topGenre, topGenreShare, swaps }`.
- Log rolled sample size + hit-rate: `"like-sample: size=N, hits=M"`.
- Log exploration-pool fill: `"exploration-budget: target=T, filled=F"`.

---

## Caching & invalidation

- **Feed cache (`recommendation_cache`):** unchanged. Rolling sample key = cache window hash, so same user in same window gets same 10-like sample → same cache hits.
- **Explore cache (`explore_cache`):** rail target bumps (M3) and cross-rail budget enforcement (M2) change rendered shape. Existing `invalidateExploreCache` triggers (thumbs-up, thumbs-down, seed change, selected_genres change, adventurous toggle) all still work. A user's cache will naturally roll over within 24h TTL, or sooner on any interaction.
- Consider bumping a cache-key version suffix (`rail_key = 'leftfield'` → `rail_key = 'leftfield-v2'`) on deploy to force invalidation, but not required.

## Risks

1. **Narrow-taste users.** Users with very narrow taste (e.g., 5 total likes, all J-rock) may see the 25% cap produce < 80 filled slots because the pool is exhausted of non-J-rock at reasonable scores. Mitigation: floor-topup already pulls from leftfield as a fallback; this is acceptable since leftfield is genre-diverse by construction.
2. **Rolling sample + Shuffle interaction.** Shuffle should ideally pick a *new* sample of 10 rather than re-shuffle the existing composition. Plan: on shuffle, advance the sample seed (`cacheWindowSeed(userId, 'like-sample-' + shuffleCount)` or similar) before invalidating rail cache.
3. **Exploration budget at 50% in Adventurous.** This is aggressive. Monitor thumbs-down rate on leftfield rail picks after ship. If it spikes, revisit the 50%.
4. **Cross-rail budget may over-correct.** If 25% is too tight for users with genuinely narrow taste, we may see lots of swap-ins from the tail of each rail. Pre-launch: dry-run the budget on a seed user with narrow taste and confirm the swap-in tail is reasonable.

## Open questions

*None blocking — all 5 decisions locked. Telemetry-driven tuning (cap %, budget %) can iterate post-ship.*

## Out of scope / future

- Rolling sample weighting (recency + random hybrid). Current decision: uniform random. If post-ship data shows stale likes dominating, revisit.
- Per-user cluster cap tuning. If product wants "strict" or "loose" modes, the cap can be exposed via a Settings slider in a future revision.
- Explicit "exploration rail" UI affordance (e.g., a "Fresh air" label on leftfield). Nice-to-have, not required.

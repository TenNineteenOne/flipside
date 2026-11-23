# Initial Page Load → 3–5s (Generation Path) — Design

**Date:** 2026-06-04
**Branch:** `perf/initial-load-3-5s` (worktree only — never merged to `main` without explicit instruction)
**Goal:** Get flipside's felt "initial page load" down to **3–5 seconds** with **zero loss in functionality** (no removed features, no dropped recommendations).

---

## 1. Problem framing

There are two distinct "page loads":

| Path | What runs | Current cost |
|---|---|---|
| **Warm** — returning user, fresh recs exist | `/` → redirect → `/feed` SSR (JWT auth, parallel DB) + hydrate | TTFB ~100–200ms (already good) |
| **Cold** — new user or stale/empty queue | splash/feed → `POST /api/recommendations/generate` → wait → render | **10–20s** (UI literally says "usually 10–20 seconds") |

The user confirmed the pain is **the generation wait** (cold path). The SSR path is already well-built (auth is JWT — no DB round-trip; feed queries parallelized via `Promise.all`). So this design targets the generation pipeline and the *timing of when it runs relative to the user*.

### Key mechanical facts (verified in code)
- `runPipeline` (`lib/recommendation/engine.ts`) already resolves a **primary** pool of `PRIMARY_RESOLVE_CAP = 60` names, writes the top 20, and returns a `runSecondary` that resolves `SECONDARY_RESOLVE_CAP = 30` more. Secondary already runs in `after()` (off the response critical path). **A background-tail mechanism already exists.**
- The blocking cost is the **primary resolve of 60 names** via `resolveArtistsByName` (`lib/recommendation/resolve-candidates.ts`).
- `resolveArtistsByName` takes `delayMs` (default 200) and `concurrency` (default 4) as **injectable params** — tuning is a one-line change at the call site in `engine.ts`. It has robust **429 backoff with a total budget**; over-tuning degrades to *slower*, never *empty/broken*.
- Decoration (color extraction + track prewarm) is already deferred to `after()`. Not on critical path. No change needed.
- Cold path entry: onboarding → `router.push("/feed")` → `RecommendationsLoader` fires generation in a `useEffect`. There is a **30s per-user cooldown** in the generate route (`last_generated_at`). Today a 429-cooldown response makes the loader show an **error**.

---

## 2. Design

Three coordinated workstreams: **B** (structural — never wait), **A** (cold backstop — return fast), **safe-C** (trim the work). Plus **Step 0** (measure first).

### Step 0 — Measurement harness (do this first)
Instrument `POST /api/recommendations/generate` with per-phase wall-clock timing:
- `gather` (gatherSeedContext), `primary-resolve`, `secondary` (in `after()`), `decoration` (in `after()`), and total-to-response.
- Log the resolver's reported `cacheHits/cacheMisses/searchRetries/rateLimited` so we can see the 429 rate.
- Surface a one-line structured log per generation (`[gen-timing] gather=… primary=… total=… misses=… retries=… rl=…`).

**Why:** every tuning and pool-size decision below is set against these real numbers, not estimates. Acceptance ("3–5s") is proven from these logs, not asserted.

### B — Pre-generate so the common case never waits (the structural win)
1. **Onboarding completion trigger.** In `handleContinue` (onboarding page), after the seeds/settings POSTs resolve, fire a **non-awaited** background generation (fire-and-forget) before/at `router.push("/feed")`. By the time the feed mounts, generation is already in flight (or done).
2. **Feed top-up trigger.** On the feed, when the user works the queue down and unseen recs drop below `MIN_FRESH` (5), fire a **background top-up** generation. Goal: `hasFreshRecs()` is almost always true → `/` redirects straight to `/feed` at warm TTFB on the next visit.
3. **Coordination fix (required).** `RecommendationsLoader` must treat a **429-cooldown** response as *"generation already in flight"* and **poll for recs** (re-fetch / `router.refresh()` on an interval, bounded) instead of showing an error. This is what lets the proactive trigger (B1/B2) coexist with the existing client trigger without the 30s cooldown surfacing as a user-visible error.

> Trigger mechanism note: triggers must respect same-origin/CSRF and the cooldown. Exact wiring (client fire-and-forget vs. a dedicated lightweight server trigger) is a planning-phase decision; the contract is "non-awaited, cooldown-safe, idempotent."

### A — Make a genuinely-cold generation return visible content fast
- Reduce the **blocking** primary resolve and lean on the existing secondary/`after()` tail for the remainder. The feed's first paint of cards happens on a smaller fast batch; the rest fills behind, invisibly (only a handful of cards are above the fold).
- **No recommendations are dropped** — the remainder still resolves in the secondary tail and lands in the queue. Only *which ~20 appear first* vs. *arrive a few seconds later* changes.
- **Blocking pool size is set by Step-0 measurement** — the largest pool that still lands inside 3–5s (expected 30–40, not a blind 30). Implemented by adjusting the primary/secondary split boundary, not by deleting candidates.

### safe-C — Trim the background generation without risking bans
- **Warm the Spotify client token** in parallel with the user-row query in the generate route (removes the cold-start 200–400ms serial blip).
- **Collapse the 2 sequential awaits** in `gatherSeedContext` (thumbs-up name resolve + genre-tag fetch currently run after the initial `Promise.all`).
- **Measured/conservative resolver tuning:** `concurrency 4→6`, `delayMs 200→125`, gated on the resolver's measured 429 rate. Revert/hold if 429s climb. Wide safety margin against bans (which would shorten feeds = the forbidden functionality loss).

---

## 3. Components & boundaries

| Unit | File(s) | Change |
|---|---|---|
| Timing harness | `app/api/recommendations/generate/route.ts`, `lib/recommendation/engine.ts` | Add per-phase timing logs (Step 0). |
| Primary/secondary split | `lib/recommendation/engine.ts` (`PRIMARY_RESOLVE_CAP`, `runPipeline`) | Shrink blocking pool; remainder → existing secondary tail. |
| Resolver tuning | `lib/recommendation/engine.ts` (call sites of `resolveArtistsByName`) | Pass tuned `concurrency`/`delayMs`. |
| Token warm + gather parallelize | generate route, `gatherSeedContext` | safe-C. |
| Onboarding trigger | `app/(marketing)/onboarding/page.tsx` (`handleContinue`) | Fire-and-forget pre-generation. |
| Feed top-up trigger | feed client / feed page | Below-threshold background generation. |
| Loader poll-on-cooldown | `components/feed/recommendations-loader.tsx` (and splash if applicable) | 429 → poll, not error. |

Each unit is independently testable; the engine changes are covered by existing `*.test.ts` patterns (resolve-candidates, regenerate, engine).

---

## 4. Error handling & invariants
- **No empty feeds:** resolver 429 backoff + `runWithSoftening` cascade (play-threshold bump → cold-start) remain untouched. Tuning never disables them.
- **No double-generation storms:** 30s cooldown stays; the loader's poll-on-cooldown is the coordination primitive.
- **No cap/quality regressions:** `applyClusterCap`, `augmentWithAdjacent`, undergroundMode hard cap all unchanged — they run over whatever pool is resolved, exactly as today.
- **Decoration unaffected:** color/tracks still best-effort in `after()`.

## 5. Testing
- Unit: engine split-boundary behavior (primary+secondary still cover the same name set); resolver tuning params plumbed; loader poll-on-cooldown state machine.
- Manual/measured: Step-0 timing logs before vs. after, across warm-cache and cold-cache runs; verify 429 rate stays near zero under tuned concurrency.
- Regression: full `vitest run` green; no feature removed.

## 6. Acceptance criteria
1. Cold generation total-to-visible-feed ≤ 5s in measured logs (warm caches), with the cold-start true-first-run materially improved.
2. Warm path unchanged (~100–200ms TTFB), and now hit on essentially every repeat visit due to B.
3. Resolver 429 rate not materially higher than baseline.
4. `vitest run` green; zero removed features; recommendation *set* per generation unchanged (only first-screen ordering may shift).

## 7. Out of scope (this spec)
- Client JS bundle / hydration wins (framer-motion eager load, dicebear barrel, fonts) — real but belong to the *warm* path; tracked separately if desired.
- `risky-C` aggressive tuning (concurrency 8+, delay 75ms) — explicitly declined.

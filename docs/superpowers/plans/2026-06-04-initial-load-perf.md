# Initial Page Load → 3–5s (Generation Path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the felt "initial page load" (the recommendation-generation wait) from 10–20s to 3–5s with zero loss in functionality.

**Architecture:** Three coordinated workstreams on top of the existing generation pipeline — (B) pre-generate so repeat visits hit the warm redirect path and fix the loader to poll-on-cooldown instead of erroring; (A) shrink the *blocking* primary resolve so cold-path cards paint fast while the existing secondary tail fills the rest; (safe-C) warm the Spotify token, parallelize the gather awaits, and conservatively tune the resolver. A measurement harness (Task 0) lands first so every tuning decision is set against real numbers.

**Tech Stack:** Next.js 16 (App Router, React 19), Supabase (`@supabase/ssr`), NextAuth (JWT), vitest (node env — no jsdom/@testing-library, so component changes are verified by typecheck + full suite + a measured dev run, not unit tests).

**Worktree-only:** All work stays on branch `perf/initial-load-3-5s`. Never merge to `main` or `Nick` without explicit user instruction.

**Spec:** `docs/superpowers/specs/2026-06-04-initial-load-perf-design.md`

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `lib/recommendation/gen-timing.ts` | Pure helper: format a per-phase timing log line | Create |
| `lib/recommendation/gen-timing.test.ts` | Test for the formatter | Create |
| `lib/recommendation/resolve-pools.ts` | Pure helper: split a name list into blocking + secondary slices | Create |
| `lib/recommendation/resolve-pools.test.ts` | Test for the split (coverage-preserving) | Create |
| `lib/recommendation/generate-response.ts` | Pure helper: classify a generate-POST status into `in-flight`/`ready`/`error` | Create |
| `lib/recommendation/generate-response.test.ts` | Test for the classifier | Create |
| `lib/recommendation/engine.ts` | Wire timing + pool split + resolver tuning constants | Modify |
| `app/api/recommendations/generate/route.ts` | Warm Spotify token in parallel; total-timing log | Modify |
| `components/feed/recommendations-loader.tsx` | Poll-on-cooldown instead of error | Modify |
| `components/splash/splash-client.tsx` | Treat 429 as "already generating → go to /feed" | Modify |
| `app/(marketing)/onboarding/page.tsx` | Fire-and-forget pre-generation before navigating to /feed | Modify |
| `components/feed/feed-client.tsx` | Background top-up generation when the queue is low | Modify |

---

## Task 0: Measurement harness (timing-first)

**Files:**
- Create: `lib/recommendation/gen-timing.ts`
- Test: `lib/recommendation/gen-timing.test.ts`
- Modify: `lib/recommendation/engine.ts`, `app/api/recommendations/generate/route.ts`

- [ ] **Step 1: Write the failing test for the timing formatter**

```ts
// lib/recommendation/gen-timing.test.ts
import { describe, it, expect } from "vitest"
import { formatGenTiming } from "./gen-timing"

describe("formatGenTiming", () => {
  it("renders a single-line structured log with rounded ms", () => {
    const line = formatGenTiming({
      userId: "u1",
      phases: { gather: 812.4, primary: 2940.9 },
      totalMs: 3810.2,
      misses: 24,
      retries: 1,
      rateLimited: false,
    })
    expect(line).toBe(
      "[gen-timing] user=u1 gather=812 primary=2941 total=3810 misses=24 retries=1 rl=false"
    )
  })

  it("omits absent phases and defaults counters to 0", () => {
    const line = formatGenTiming({ userId: "u2", phases: {}, totalMs: 100.6 })
    expect(line).toBe("[gen-timing] user=u2 total=101 misses=0 retries=0 rl=false")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/recommendation/gen-timing.test.ts`
Expected: FAIL — `Cannot find module './gen-timing'`.

- [ ] **Step 3: Implement the formatter**

```ts
// lib/recommendation/gen-timing.ts
export interface GenTiming {
  userId: string
  /** Phase wall-clock durations in ms (e.g. gather, primary). Order preserved. */
  phases: Record<string, number>
  totalMs: number
  misses?: number
  retries?: number
  rateLimited?: boolean
}

/**
 * Format a single structured log line for one generation run. Numbers are
 * rounded to whole ms. Used to drive the measurement-led tuning in this plan
 * (blocking pool size + resolver concurrency/delay) against real numbers.
 */
export function formatGenTiming(t: GenTiming): string {
  const phaseBits = Object.entries(t.phases).map(([k, v]) => `${k}=${Math.round(v)}`)
  return [
    "[gen-timing]",
    `user=${t.userId}`,
    ...phaseBits,
    `total=${Math.round(t.totalMs)}`,
    `misses=${t.misses ?? 0}`,
    `retries=${t.retries ?? 0}`,
    `rl=${t.rateLimited ?? false}`,
  ].join(" ")
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/recommendation/gen-timing.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Instrument `runPipeline` to capture phase timings**

In `lib/recommendation/engine.ts`, add timing around the primary resolve and thread the numbers out through `BuildResult`. First, at the top of `runPipeline` (just before `const firstHop = await Promise.all(`), no change is needed yet — we wrap the resolve. Replace the primary-resolve block (currently around lines 521–527):

```ts
  const primaryStart = Date.now()
  const resolved = await resolveArtistsByName(uniqueNames, {
    cache: nameCache,
    searchArtists: (name) => musicProvider.searchArtists(accessToken, name),
    enrichArtist: buildEnrichArtist(),
  })
  const primaryMs = Date.now() - primaryStart

  console.log(`[cache-search] hit=${resolved.cacheHits} miss=${resolved.cacheMisses} total=${uniqueNames.length}`)
```

Then attach the metrics to the return value. At the **two** `return { count: rows.length, runSecondary }` / early-return sites that represent a *successful* primary pass, add a `metrics` field. Change the final success return (currently `return { count: rows.length, runSecondary }`, ~line 835) to:

```ts
  return {
    count: rows.length,
    runSecondary,
    metrics: {
      primaryMs,
      misses: resolved.cacheMisses,
      retries: resolved.searchRetries,
      rateLimited: resolved.rateLimited,
    },
  }
```

- [ ] **Step 6: Extend `BuildResult` with the optional metrics field**

In `lib/recommendation/types.ts`, add to the `BuildResult` interface (keep it optional so the cold-start/early-return paths that don't set it still type-check):

```ts
  metrics?: {
    primaryMs: number
    misses: number
    retries: number
    rateLimited: boolean
  }
```

- [ ] **Step 7: Emit the timing line from the generate route**

In `app/api/recommendations/generate/route.ts`, import the formatter at the top with the other imports:

```ts
import { formatGenTiming } from "@/lib/recommendation/gen-timing"
```

Wrap the `buildRecommendations` call (currently ~lines 249–258) with a total timer and log after it returns:

```ts
    const genStart = Date.now()
    const { count: recCount, runSecondary, softenedFilters, metrics } = await buildRecommendations({
      userId: user.id,
      accessToken,
      playThreshold,
      popularityCurve,
      genre,
      undergroundMode: user.underground_mode ?? false,
      deepDiscovery: user.deep_discovery ?? false,
      adventurous: user.adventurous ?? false,
    })
    console.log(formatGenTiming({
      userId: user.id,
      phases: metrics ? { primary: metrics.primaryMs } : {},
      totalMs: Date.now() - genStart,
      misses: metrics?.misses,
      retries: metrics?.retries,
      rateLimited: metrics?.rateLimited,
    }))
```

(`buildRecommendations` returns `BuildResult`, so `metrics` is now available; `softenedFilters` was already destructured.)

- [ ] **Step 8: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all existing tests still green plus the 2 new ones.

- [ ] **Step 9: Commit**

```bash
git add lib/recommendation/gen-timing.ts lib/recommendation/gen-timing.test.ts lib/recommendation/types.ts lib/recommendation/engine.ts app/api/recommendations/generate/route.ts
git commit -m "Add generation timing harness (gen-timing + per-phase metrics)"
```

---

## Task 1: Approach A — shrink the blocking resolve pool

**Files:**
- Create: `lib/recommendation/resolve-pools.ts`
- Test: `lib/recommendation/resolve-pools.test.ts`
- Modify: `lib/recommendation/engine.ts`

**Why:** Today `runPipeline` blocks on resolving 60 names before writing the feed. We split that into a smaller **blocking** slice (paints the visible feed fast) and a larger **secondary** slice that already runs in `after()`. No names are dropped — the union is identical to today's `slice(0, 90)`.

- [ ] **Step 1: Write the failing test for the pool split**

```ts
// lib/recommendation/resolve-pools.test.ts
import { describe, it, expect } from "vitest"
import { splitResolvePools, BLOCKING_RESOLVE_CAP, SECONDARY_RESOLVE_CAP } from "./resolve-pools"

const names = (n: number) => Array.from({ length: n }, (_, i) => `a${i}`)

describe("splitResolvePools", () => {
  it("blocking slice is capped at BLOCKING_RESOLVE_CAP", () => {
    const { blocking } = splitResolvePools(names(200))
    expect(blocking).toHaveLength(BLOCKING_RESOLVE_CAP)
    expect(blocking[0]).toBe("a0")
  })

  it("secondary continues immediately after blocking with no gap and no overlap", () => {
    const { blocking, secondary } = splitResolvePools(names(200))
    expect(secondary[0]).toBe(`a${BLOCKING_RESOLVE_CAP}`)
    expect(secondary).toHaveLength(SECONDARY_RESOLVE_CAP)
    // Union preserves the original ordering with no duplicates.
    expect([...blocking, ...secondary]).toEqual(names(BLOCKING_RESOLVE_CAP + SECONDARY_RESOLVE_CAP))
  })

  it("coverage equals the legacy 90-name window (no recs dropped)", () => {
    const { blocking, secondary } = splitResolvePools(names(200))
    const covered = new Set([...blocking, ...secondary])
    expect(covered.size).toBe(BLOCKING_RESOLVE_CAP + SECONDARY_RESOLVE_CAP)
    expect(BLOCKING_RESOLVE_CAP + SECONDARY_RESOLVE_CAP).toBe(90) // same total window as before
  })

  it("handles short lists without overrun", () => {
    const { blocking, secondary } = splitResolvePools(names(10))
    expect(blocking).toEqual(names(10))
    expect(secondary).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/recommendation/resolve-pools.test.ts`
Expected: FAIL — `Cannot find module './resolve-pools'`.

- [ ] **Step 3: Implement the split helper**

```ts
// lib/recommendation/resolve-pools.ts
/**
 * Blocking resolve cap (Approach A). Set by measurement in Task 6: the largest
 * value that still lands the cold generation inside 3–5s. Default 36 — start
 * here, then adjust from the Task-0 `[gen-timing]` logs.
 *
 * NOTE: BLOCKING_RESOLVE_CAP + SECONDARY_RESOLVE_CAP must stay == 90 so the
 * total candidate window matches the legacy PRIMARY(60)+SECONDARY(30) behavior.
 * No recommendations are dropped; only the blocking/background boundary moves.
 */
export const BLOCKING_RESOLVE_CAP = 36
export const SECONDARY_RESOLVE_CAP = 90 - BLOCKING_RESOLVE_CAP

export interface ResolvePools {
  /** Resolved synchronously before the feed is written (paints visible cards). */
  blocking: string[]
  /** Resolved in the background `after()` tail; appended to the queue. */
  secondary: string[]
}

/** Split a round-robin-ordered name list into blocking + secondary slices. */
export function splitResolvePools(allNames: string[]): ResolvePools {
  return {
    blocking: allNames.slice(0, BLOCKING_RESOLVE_CAP),
    secondary: allNames.slice(BLOCKING_RESOLVE_CAP, BLOCKING_RESOLVE_CAP + SECONDARY_RESOLVE_CAP),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/recommendation/resolve-pools.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the split into `runPipeline`**

In `lib/recommendation/engine.ts`:

1. Add the import near the other `./` imports (top of file):

```ts
import { splitResolvePools } from './resolve-pools'
```

2. Delete the now-unused module constants `PRIMARY_RESOLVE_CAP` and `SECONDARY_RESOLVE_CAP` (currently lines 158–159).

3. Replace the slicing block (currently lines 493–495):

```ts
  const allNames = buildRoundRobinNames(lfmResults, knownNames, { tailFirst: true })
  const { blocking: uniqueNames, secondary: secondaryNames } = splitResolvePools(allNames)
```

Everything downstream already refers to `uniqueNames` / `secondaryNames`, so no further changes are needed.

- [ ] **Step 6: Typecheck + full suite (engine tests must still pass)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; `lib/recommendation/engine.test.ts` and all others green. (If an engine test hard-codes `PRIMARY_RESOLVE_CAP`/60, update that assertion to `BLOCKING_RESOLVE_CAP`/36 — the union/coverage contract is unchanged.)

- [ ] **Step 7: Commit**

```bash
git add lib/recommendation/resolve-pools.ts lib/recommendation/resolve-pools.test.ts lib/recommendation/engine.ts
git commit -m "A: split primary resolve into fast blocking + background secondary pools"
```

---

## Task 2: safe-C — warm token, parallelize gather, tune resolver

**Files:**
- Modify: `app/api/recommendations/generate/route.ts`, `lib/recommendation/engine.ts`

**Why:** Three no-/low-risk trims. The resolver already has 429 backoff, so tuning degrades to *slower*, never *empty*.

- [ ] **Step 1: Warm the Spotify client token in parallel with the user-row query**

In `app/api/recommendations/generate/route.ts`, the user query (lines ~175–179) and the token fetch (line ~239) currently run sequentially. Kick the token fetch off *before* awaiting the user row, then await it where it's used.

Add the import (top of file) if not already present — it is: `getSpotifyClientToken`. Replace the user-row fetch block start so the token promise launches first:

```ts
  const supabase = createServiceClient()

  // Warm the Spotify client token concurrently with the user-row read. On
  // serverless cold starts the module-cached token is empty; overlapping it
  // with the DB round-trip removes a 200–400ms serial blip. We only consume
  // this if the user has no personal Spotify token (see below).
  const clientTokenPromise = getSpotifyClientToken().catch(() => null)

  // Read user row including play_threshold
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, play_threshold, popularity_curve, underground_mode, deep_discovery, adventurous, last_generated_at")
    .eq("id", userId)
    .maybeSingle()
```

Then change the token resolution (currently `const accessToken = userAccessToken ?? (await getSpotifyClientToken())`, ~line 239) to consume the warmed promise:

```ts
    const accessToken = userAccessToken ?? (await clientTokenPromise)
```

To avoid an unhandled-rejection if the user path is taken and the promise is never awaited, the `.catch(() => null)` above already settles it. Good.

- [ ] **Step 2: Parallelize the two dependent awaits in `gatherSeedContext`**

In `lib/recommendation/engine.ts`, the thumbs-up name resolve (lines ~122–132) and the genre-tag fetch (lines ~136–139) both depend only on the *first* `Promise.all`'s results, and are independent of each other — but currently run sequentially. Run them concurrently.

Replace the block from `const sampledThumbsUp = sampleLikes(...)` through the end of the `if (topGenres.length > 0)` block with:

```ts
  const sampledThumbsUp = sampleLikes(thumbsUpRows, userId)
  const userGenres = ((userRow?.selected_genres as string[] | null) ?? [])
  const topGenres = userGenres.slice(0, 5)

  const [thumbsUpNames, genreBatches] = await Promise.all([
    // Resolve sampled thumbs-up IDs → names via the rec cache.
    sampledThumbsUp.length === 0
      ? Promise.resolve([] as string[])
      : supabase
          .from('recommendation_cache')
          .select('artist_data')
          .eq('user_id', userId)
          .in('spotify_artist_id', sampledThumbsUp)
          .then(({ data }) =>
            (data ?? [])
              .map((row) => (row.artist_data as { name?: string })?.name)
              .filter((n): n is string => !!n)
          ),
    // Genre seed names from Last.fm tags (each cached).
    topGenres.length === 0
      ? Promise.resolve([] as string[])
      : Promise.all(topGenres.map(getTagArtistNames)).then((batches) => batches.flat()),
  ])

  names.push(...thumbsUpNames)
  names.push(...genreBatches)
```

(Remove the old sequential `if (sampledThumbsUp.length > 0) { ... }` and `if (topGenres.length > 0) { ... }` blocks and the now-duplicated `const userGenres`/`const topGenres` declarations. The `console.log` below and the `return { seedNames: deduped, userGenres }` stay as-is.)

- [ ] **Step 3: Add conservative resolver tuning at the blocking-resolve call site**

In `lib/recommendation/engine.ts`, define tuning constants near the top (under the existing `const ADAPTIVE_BROADEN_THRESHOLD` block):

```ts
/**
 * Resolver tuning (safe-C). Conservative bump over the resolver defaults
 * (concurrency 4 / delay 200ms). The resolver has 429 backoff with a budget,
 * so over-tuning degrades to slower, never empty. Validate the measured 429
 * rate via the [gen-timing] `rl`/`retries` fields (Task 6) before going higher.
 */
const RESOLVE_CONCURRENCY = 6
const RESOLVE_DELAY_MS = 125
```

Then pass them to the **blocking** resolve call (the `const resolved = await resolveArtistsByName(uniqueNames, {...})` block from Task 0 Step 5):

```ts
  const primaryStart = Date.now()
  const resolved = await resolveArtistsByName(uniqueNames, {
    cache: nameCache,
    searchArtists: (name) => musicProvider.searchArtists(accessToken, name),
    enrichArtist: buildEnrichArtist(),
    concurrency: RESOLVE_CONCURRENCY,
    delayMs: RESOLVE_DELAY_MS,
  })
  const primaryMs = Date.now() - primaryStart
```

Leave the secondary resolve (`secondaryResolvePromise`) and the `augmentWithAdjacent` resolve at resolver defaults — they run in the background `after()` tail, so their latency doesn't block first paint, and keeping them at default concurrency further reduces peak Spotify pressure.

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests green. (`gatherSeedContext` is exercised indirectly by `engine.test.ts`; if a test asserts exact call ordering it may need a tweak — the *output* set is unchanged.)

- [ ] **Step 5: Commit**

```bash
git add app/api/recommendations/generate/route.ts lib/recommendation/engine.ts
git commit -m "safe-C: warm Spotify token, parallelize gather awaits, conservative resolver tuning"
```

---

## Task 3: B3 — loader polls on cooldown instead of erroring

**Files:**
- Create: `lib/recommendation/generate-response.ts`
- Test: `lib/recommendation/generate-response.test.ts`
- Modify: `components/feed/recommendations-loader.tsx`, `components/splash/splash-client.tsx`

**Why:** With pre-generation (Tasks 4–5), a proactive generation may already be in flight when the loader fires, and the 30s cooldown returns 429. Today that surfaces as an *error*. It must instead mean "already generating — poll for results."

- [ ] **Step 1: Write the failing test for the response classifier**

```ts
// lib/recommendation/generate-response.test.ts
import { describe, it, expect } from "vitest"
import { classifyGenerateResponse } from "./generate-response"

describe("classifyGenerateResponse", () => {
  it("treats 429 as in-flight (poll, don't error)", () => {
    expect(classifyGenerateResponse(429, { error: "Please wait before generating more recommendations" }))
      .toBe("in-flight")
  })

  it("treats a full-queue 429 as ready (there are already recs to show)", () => {
    expect(classifyGenerateResponse(429, { error: "Your discovery queue is full. Please review some artists before generating more." }))
      .toBe("ready")
  })

  it("treats 2xx as ready", () => {
    expect(classifyGenerateResponse(200, { count: 20 })).toBe("ready")
  })

  it("treats count:0 success as error (nothing found)", () => {
    expect(classifyGenerateResponse(200, { count: 0 })).toBe("error")
  })

  it("treats 5xx as error", () => {
    expect(classifyGenerateResponse(503, { error: "Music service temporarily unavailable" })).toBe("error")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/recommendation/generate-response.test.ts`
Expected: FAIL — `Cannot find module './generate-response'`.

- [ ] **Step 3: Implement the classifier**

```ts
// lib/recommendation/generate-response.ts
export type GenerateOutcome = "ready" | "in-flight" | "error"

interface GenerateBody {
  count?: number
  error?: string
}

/**
 * Classify a POST /api/recommendations/generate response so the client can
 * decide whether to render the feed (`ready`), poll for an in-progress run
 * (`in-flight`), or show an error (`error`).
 *
 * The 30s cooldown returns 429 with a "please wait" message — that means a
 * generation is already running (likely a proactive pre-generation), so we
 * poll. A "queue full" 429 means recs already exist → ready. count:0 means a
 * successful run found nothing → error (actionable message upstream).
 */
export function classifyGenerateResponse(status: number, body: GenerateBody): GenerateOutcome {
  if (status === 429) {
    const msg = (body.error ?? "").toLowerCase()
    if (msg.includes("queue")) return "ready"
    return "in-flight"
  }
  if (status >= 200 && status < 300) {
    return body.count === 0 ? "error" : "ready"
  }
  return "error"
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/recommendation/generate-response.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Rewrite the loader to poll on in-flight**

Replace the body of `components/feed/recommendations-loader.tsx` with:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"
import { classifyGenerateResponse } from "@/lib/recommendation/generate-response"

/** Poll cadence + ceiling while a generation is in flight. */
const POLL_INTERVAL_MS = 2500
const POLL_MAX_MS = 30_000

export function RecommendationsLoader() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    /** Poll GET /api/recommendations until recs appear or the ceiling is hit. */
    async function pollUntilReady(deadline: number): Promise<void> {
      while (!cancelled && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        if (cancelled) return
        const res = await fetch("/api/recommendations")
        if (!res.ok) continue
        const data = (await res.json().catch(() => ({}))) as { recommendations?: unknown[] }
        if ((data.recommendations?.length ?? 0) > 0) {
          if (!cancelled) router.refresh()
          return
        }
      }
      if (!cancelled) setError("Still working on your feed — refresh in a moment.")
    }

    async function generate() {
      try {
        const res = await fetch("/api/recommendations/generate", { method: "POST" })
        if (cancelled) return
        const data = (await res.json().catch(() => ({}))) as { count?: number; error?: string }
        const outcome = classifyGenerateResponse(res.status, data)

        if (outcome === "ready") {
          router.refresh()
          return
        }
        if (outcome === "in-flight") {
          await pollUntilReady(Date.now() + POLL_MAX_MS)
          return
        }
        // outcome === "error"
        if (res.ok && data.count === 0) {
          throw new Error("No new artists found. Your listening history may be filtering everything out — try raising your play threshold in Settings.")
        }
        throw new Error(data.error ?? "Generation failed")
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load recommendations")
        }
      }
    }

    generate()
    return () => {
      cancelled = true
    }
  }, [router, attempt])

  if (error) {
    return (
      <div className="col" style={{ minHeight: "60vh", alignItems: "center", justifyContent: "center", gap: 16, padding: "0 16px", textAlign: "center" }}>
        <p style={{ fontSize: 14, color: "var(--dislike)" }}>{error}</p>
        <button
          className="btn"
          onClick={() => {
            setError(null)
            setAttempt((n) => n + 1)
          }}
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <RefreshCw size={16} />
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="col" style={{ minHeight: "60vh", alignItems: "center", justifyContent: "center", gap: 16, padding: "0 16px", textAlign: "center" }}>
      <div style={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <Loader2 size={32} className="animate-spin" style={{ color: "var(--accent)" }} />
      </div>
      <div className="col" style={{ gap: 6 }}>
        <p className="serif" style={{ fontSize: 18, fontWeight: 600 }}>Discovering music for you…</p>
        <p className="muted" style={{ fontSize: 14 }}>
          Building your discovery feed. This takes about 15 seconds on your first visit.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Make the splash treat 429 as "already generating → /feed"**

In `components/splash/splash-client.tsx`, replace `handleGenerate` (lines ~28–38) so a 429 routes to the feed (where the polling loader takes over) instead of erroring:

```tsx
  async function handleGenerate() {
    setStatus("generating")
    try {
      const res = await fetch("/api/recommendations/generate", { method: "POST" })
      // 429 = a generation is already in flight (e.g. proactive pre-gen). Hand
      // off to /feed, whose loader polls for the result.
      if (res.ok || res.status === 429) {
        router.push("/feed")
        return
      }
      throw new Error(`http_${res.status}`)
    } catch (err) {
      console.error("[splash] generate failed", err)
      setStatus("error")
    }
  }
```

- [ ] **Step 7: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests green (5 new classifier tests included).

- [ ] **Step 8: Commit**

```bash
git add lib/recommendation/generate-response.ts lib/recommendation/generate-response.test.ts components/feed/recommendations-loader.tsx components/splash/splash-client.tsx
git commit -m "B3: loader polls on cooldown; splash hands 429 off to feed"
```

---

## Task 4: B1 — fire pre-generation at onboarding completion

**Files:**
- Modify: `app/(marketing)/onboarding/page.tsx`

**Why:** Today onboarding navigates to `/feed`, *then* the loader starts generation (a cold 15s wait). Firing a non-awaited generation right after the seeds save overlaps generation with navigation, so it's underway (or done) by the time the feed mounts. Coordinated with B3's poll-on-cooldown.

- [ ] **Step 1: Add the fire-and-forget pre-generation before navigation**

In `app/(marketing)/onboarding/page.tsx`, inside `handleContinue`, after `const results = await Promise.all(promises)` and the `failed` check, *before* `router.push("/feed")` (currently line 111), insert:

```tsx
      // Kick off recommendation generation now (non-awaited) so it overlaps
      // with navigation and is underway/done by the time the feed mounts.
      // Cooldown-safe: if the feed's loader also fires, it gets a 429 and polls
      // (see classifyGenerateResponse / RecommendationsLoader). Seeds are saved
      // above, so the engine sees them on this run.
      void fetch("/api/recommendations/generate", { method: "POST" }).catch(() => {})

      router.push("/feed")
```

- [ ] **Step 2: Typecheck + build (catches client/runtime wiring)**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(marketing)/onboarding/page.tsx"
git commit -m "B1: fire-and-forget pre-generation at onboarding completion"
```

---

## Task 5: B2 — background top-up when the feed queue is low

**Files:**
- Modify: `components/feed/feed-client.tsx`

**Why:** Keep `hasFreshRecs()` true so repeat visits hit the warm redirect path (`/` → `/feed` at ~100–200ms). When the feed renders with a low unseen count, top up in the background. Reuses the existing POST + the synchronous ref-guard pattern already in this file.

- [ ] **Step 1: Add the low-queue background top-up effect**

In `components/feed/feed-client.tsx`:

1. Add `useEffect` to the React import (line 3):

```tsx
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
```

2. Add a threshold constant just above the `FeedClient` component (near `FEED_PALETTE`, module scope):

```tsx
// Below this many unseen recs on load, quietly top up in the background so the
// next visit hits the warm redirect path (hasFreshRecs stays true). The visible
// feed is unchanged this load; new recs land server-side for next time.
const TOPUP_THRESHOLD = 8
```

3. Inside `FeedClient`, after the existing `const router = useRouter()` (line 78), add the effect. It reuses `isGeneratingRef` so it can't race the "Load more" button:

```tsx
  // Background top-up: fire once on mount if the queue is running low. Non-
  // awaited and cooldown-safe (a 429 just means a generation is already in
  // flight). We intentionally do NOT router.refresh() — this is for the *next*
  // visit's warm path, not to mutate the current view out from under the user.
  useEffect(() => {
    if (recommendations.length >= TOPUP_THRESHOLD) return
    if (isGeneratingRef.current) return
    isGeneratingRef.current = true
    let cancelled = false
    fetch("/api/recommendations/generate", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) isGeneratingRef.current = false
      })
    return () => {
      cancelled = true
      isGeneratingRef.current = false
    }
    // Mount-only: deliberately not re-firing on recommendations identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add components/feed/feed-client.tsx
git commit -m "B2: background top-up when feed queue is low (keeps warm path hot)"
```

---

## Task 6: Measured tuning (set the real numbers)

**Files:**
- Modify (values only): `lib/recommendation/resolve-pools.ts`, `lib/recommendation/engine.ts`

**Why:** Tasks 1–2 shipped *default* values (`BLOCKING_RESOLVE_CAP = 36`, `RESOLVE_CONCURRENCY = 6`, `RESOLVE_DELAY_MS = 125`). This task replaces guesses with measurements. **Requires a real dev run with valid `SPOTIFY_*` and `LASTFM_API_KEY` env vars** — it cannot be done from unit tests.

- [ ] **Step 1: Run the app and capture baseline + tuned timings**

```bash
npm run dev
```

Trigger a cold generation (new user / cleared queue) and read the server logs for the `[gen-timing]` line from Task 0. Record `primary`, `total`, `misses`, `retries`, `rl` across 3–5 cold runs and 3–5 warm-cache runs.

- [ ] **Step 2: Set `BLOCKING_RESOLVE_CAP` to the largest value that keeps `total` ≤ 5000ms**

Edit `lib/recommendation/resolve-pools.ts`. If warm-cache `total` is already well under 5s at 36, raise toward 40–48 (more first-screen quality) as long as `total` stays ≤ 5s. If cold `total` exceeds 5s, lower toward 24–30. Keep `BLOCKING_RESOLVE_CAP + SECONDARY_RESOLVE_CAP === 90` (the constant derives `SECONDARY` automatically, so only change the one number).

- [ ] **Step 3: Validate resolver tuning against the 429 rate**

If `rl=true` or `retries` is climbing across runs, **revert** `RESOLVE_CONCURRENCY`/`RESOLVE_DELAY_MS` toward defaults (4 / 200) in `lib/recommendation/engine.ts` until `rl=false` and `retries` is ~0. The ban-avoidance guarantee outranks raw speed. Only hold the 6/125 values if the 429 rate stays at baseline.

- [ ] **Step 4: Re-run the suite and commit the chosen values**

```bash
npx tsc --noEmit && npx vitest run
git add lib/recommendation/resolve-pools.ts lib/recommendation/engine.ts
git commit -m "Task 6: set blocking pool + resolver tuning from measured timings"
```

> If a real dev run isn't possible in this environment, leave the Task-1/2 defaults in place, note that measured tuning is pending, and hand the `[gen-timing]` instructions to the user to finalize. Do **not** invent numbers.

---

## Task 7: Regression + bug/intent-drift sweep

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck, lint, and test suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: all green.

- [ ] **Step 2: Production build (catches RSC/client boundary + dynamic-route issues)**

Run: `npm run build`
Expected: build succeeds; no new warnings about the modified routes/components.

- [ ] **Step 3: Manual smoke of all four functional paths (zero-functionality-loss check)**

Verify, against `npm run dev`:
1. **Brand-new user** → onboarding → feed paints within ~3–5s (cold), no error toast, loader polls cleanly if it 429s.
2. **Returning user with fresh recs** → `/` redirects straight to `/feed` (warm, instant).
3. **Returning user, stale/empty queue** → loader generates or polls, feed paints, no spurious error.
4. **"Load more" button** and **Settings → regenerate** still work (no double-fire, correct toasts).

- [ ] **Step 4: Dispatch a bug + intent-drift sweep subagent**

Per project rule, after the plan ships, dispatch a subagent to diff the worktree against `Nick` and report: any dropped functionality, any path where a 429/error now reaches the user, any place a background generation could storm (cooldown bypass), and any RSC/client-boundary violation. Fix anything it surfaces.

- [ ] **Step 5: Final commit (if the sweep produced fixes)**

```bash
git add -A
git commit -m "Address bug/intent-drift sweep findings for initial-load perf"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** Step 0 → Task 0; B1 → Task 4; B2 → Task 5; B3 → Task 3; A (shrink blocking pool) → Task 1 + Task 6; safe-C (token/gather/tuning) → Task 2 + Task 6; measurement-led acceptance → Task 0 + Task 6; regression/no-loss → Task 7. All spec sections mapped.
- **Out-of-scope respected:** no bundle/font work (spec §7); no risky-C aggressive tuning.
- **Type consistency:** `BuildResult.metrics` (Task 0 Step 6) is consumed in Task 0 Step 7 and produced in Task 0 Step 5; `splitResolvePools`/`BLOCKING_RESOLVE_CAP`/`SECONDARY_RESOLVE_CAP` defined in Task 1 Step 3 and used in Task 1 Step 5 + Task 6; `classifyGenerateResponse`/`GenerateOutcome` defined in Task 3 Step 3 and consumed in Task 3 Step 5; `isGeneratingRef` reused consistently in Task 5.
- **No placeholders:** every code step shows complete code; the only deferred *values* are explicitly measurement-driven (Task 6) with safe defaults shipped first.

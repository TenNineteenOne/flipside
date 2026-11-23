# Design: Fast first paint (see something in 3-5s, fill in background)

**Date:** 2026-06-06
**Status:** Approved (design); pending implementation plan
**Author:** flux + Claude
**Related:** builds on `2026-06-05-guaranteed-playable-previews-design.md` (PR #139, `feat/playable-previews`)

## Goal

The user must **see real content within 3-5s** (target 3s) on the feed, Explore,
and after hitting Settings "Regenerate Feed & Explore". This does **not** require
the full set to be generated in that window — a small first batch paints fast and
the rest fills in the background.

The hard playable-preview guarantee from the prior design is **preserved**: every
card that actually renders is confirmed to have ≥1 playable preview. We change
*when* and *how many* artists we confirm, not whether shown cards are guaranteed.

## Problem being fixed

The previews work (PR #139) regressed load time and now self-throttles the shared
API keys:

1. **Confirm-all-then-pick.** `resolveArtistsByName` confirms previews for *every*
   resolved artist (~36 blocking + rails + secondary) and only then scores/picks
   the top 20. We confirm ~36 to show 20 — and every confirm is an iTunes call
   (plus a Spotify fallback when iTunes is empty), all on the blocking path.
2. **Paint waits for the whole primary set.** The client loader POSTs
   `/api/recommendations/generate`, which blocks through the full primary resolve +
   confirm + write (measured 20-35s on feed, 54-74s on Explore) before
   `router.refresh()` paints anything.
3. **Self-DDoS of one shared credential.** flipside has a single set of API keys
   across local/preview/prod. The per-artist confirm fan-out across feed + 4 rails
   + secondary bursts iTunes (→ HTTP 403, per-IP) and Spotify (→ HTTP 429,
   `retry-after ≈ 24h`, keyed to the credential). A single regen can block the
   prod key for ~24h. Confirmed in dev logs (`[itunes] 403`, `[s429] retry-after=85784s`).

The diagnosis established that **request-count**, not wall-clock, is the robust
target: the shared key means no environment has healthy keys to measure against
until the throttle decays, and the fix must reduce volume regardless.

## Definition of "see something"

First paint shows a batch of **~8 real, guaranteed-playable cards** (no skeleton
placeholders — chosen in design Q1, option A). The screen is blank only until that
batch lands (~3-5s). The rest stream in behind it.

## Architecture

### Principle

> Confirm only what renders. Return after a tiny confirmed batch. Fill the rest in
> the background. Never let preview-confirmation burst the shared keys.

### 1. The reorder: pick-then-confirm-then-backfill (deep change)

Today: `resolve (~36) → confirm ALL → score → pick 20`.

New: `resolve → score → pick top N → confirm ONLY those N → drop empties →
backfill from the already-resolved pool, confirming only the promoted ones`.

- Confirm count drops from ~36 to ~the 8-20 actually shown. This is simultaneously
  the speed win (less blocking work) and the volume win (fewer API calls → no
  self-throttle).
- A new deep helper in `lib/recommendation/confirm-previews.ts` confirms a *given
  list* of picked artists and **stops once the target count of playable artists is
  reached**, so on healthy keys Tier 1 is ~1 iTunes batch.
- The preview-confirm pass currently living inside `resolveArtistsByName`
  (`resolve-candidates.ts`, the "confirm every resolved artist" loop) is removed
  from the resolver and relocated to the engine's pick stage. The resolver returns
  to writing the bare name-cache entry; the engine confirms-on-promote and bakes
  `topTracks` into the rows it actually selects.

### 2. Three tiers in `generate`

```
TIER 1 (blocking):  gather seeds → resolve a small candidate set → score
                    → confirm top ~8 (stop at 8 playable) → write 8 → return
                    ⟶ client paints in 3-5s
TIER 2 (after()):   resolve+confirm rest of primary → write up to ~20
TIER 3 (after()):   secondary pool (existing runSecondary) + colour extraction
```

- `FIRST_BATCH_TARGET = 8` (tunable constant). Tier 1 resolves a slightly larger
  candidate pool (~12-16) to absorb preview-drops, but confirms lazily and stops at
  8 playable.
- Tiers 2/3 run in the existing `after()` block. They confirm-on-promote too, so
  the guarantee holds for every written card.
- `generate` returns `{ success, count, phase: 'first-batch' }` after Tier 1.

### 3. Client fill (feed)

`FeedClient` gains a background poller (new `lib/hooks/use-feed-fill.ts`, reusing
the loader's existing `GET /api/recommendations` poll cadence). After first paint it
keeps fetching and **appends new unseen cards**, dedup by `spotify_artist_id`, until
it reaches ~20 or generation goes idle (K consecutive polls with no growth). The
feed grows 8 → 20 while the user reviews one card at a time, so the buffer rarely
runs dry. (Q2 option A.)

### 4. Throttle protection: preview-source circuit breaker

New deep module `lib/preview-source-breaker.ts` — a closed→open→half-open state
machine, one breaker per source:

- **iTunes** (`lib/itunes-limit.ts`): lower concurrency from 12 to ~5, add a
  min-interval between calls, and wrap calls in the breaker. On repeated `403/429`,
  the breaker **opens** → iTunes calls short-circuit (skip to Spotify/cache/drop)
  for a cooldown, then **half-opens** to probe. Stops the self-DDoS that earns the
  403.
- **Spotify** (`spotify-provider.ts`): on a fresh `429`, set a process-level
  "Spotify cold until `now + retry-after`" flag; `getArtistTopTracks` (and the
  search path) short-circuit to empty instead of re-hammering, honoring
  `retry-after`. This is what prevents one regen from 24h-blocking the shared key.

The breaker is unit-testable in isolation (feed it synthetic 403/429 sequences,
assert state transitions and short-circuit behavior).

### 5. Explore

Same reorder per rail: confirm only the cards a rail will show (e.g. top ~12 of the
`LEFTFIELD_RESOLVE_CAP = 48` resolved), not the whole pool. `buildExploreRails`
returns cached rails immediately; `force` regeneration moves into `after()` instead
of blocking the response. The Explore client polls to swap in freshly-generated
rails. 54-74s → cached-instant paint + background refresh.

### 6. Settings "Regenerate Feed & Explore" button

Stop awaiting full generation. Fire feed + Explore regen; flip the button back as
soon as the **first batches** are written (or flip optimistically with an
"updating…" hint) and let background fill continue. 60s → 3-5s. The button reflects
that *new* content is arriving, not that *all* content is done.

### 7. Measurement / instrumentation

- **Fix the metrics drop.** `gen-timing` currently prints no `primary=`/`preview=`
  (the `metrics` object is lost on the returned path). Repair the plumbing so
  `gen-timing` reliably prints `firstBatch= primary= preview=` phase durations.
- **Add per-generation API call counters** to the `gen-timing` line:
  `itunesCalls= spotifyCalls=` (attempts, not just successes).
- **Primary success metric:** call-count down **and** time-to-first-batch-written
  < 5s (target 3s). Both are observable on the throttled dev box (we count
  *attempts*; fewer attempts during a 403 storm = the fix working), so we are not
  blocked on shared-key recovery to verify.

## Guarantee under outage (unchanged, explicit)

The hard-drop guarantee stays for *shown* cards. If both providers are externally
throttled and Tier 1 cannot fill 8, the feed falls back to the existing retry state
("Still working on your feed") — the same behavior as today, not a new regression.
The volume reduction + breaker make *self*-induced throttle rare; an external
provider outage is out of scope to mask. The guarantee is **not** relaxed (the user
was explicit: drop the card, never show a dead button).

## Modules (deep, isolated, testable)

| Module | Responsibility | Tested |
| --- | --- | --- |
| `lib/preview-source-breaker.ts` (new) | closed→open→half-open breaker per source; short-circuit on 403/429 | yes |
| `lib/recommendation/confirm-previews.ts` | add "confirm these picked artists, stop at target" helper | yes |
| `lib/recommendation/resolve-candidates.ts` | remove confirm-all pass; return bare resolved set | yes (call-count) |
| `lib/recommendation/engine.ts` | pick→confirm→backfill; Tier-1 cap + early return; rest to `after()` | yes |
| `lib/itunes-limit.ts` | lower concurrency + min-interval + breaker wrap | yes (cap) |
| `lib/recommendation/gen-timing.ts` | add `itunesCalls`/`spotifyCalls` + fix metrics plumbing | yes |
| `lib/hooks/use-feed-fill.ts` (new) | background append-poller; dedup; stop at target/idle | yes |
| `app/api/recommendations/generate/route.ts` | Tier-1 early return; Tiers 2/3 in `after()` | — |
| Explore engine + page + client | per-rail confirm-only-shown; cached-fast + bg refresh; poll fill | partial |
| Settings regenerate button | non-blocking flip | — |

## Testing decisions

Test external behavior, not internals:

- **confirm-only-shown:** picking top N confirms exactly N (+ promoted backfills),
  never the full resolved pool — asserted via injected dep call-counts (prior art:
  `confirm-previews.test.ts` already uses `itunesCallCount`/`spotifyCallCount`).
- **Tier-1 early return:** `generate` writes ~8 and returns before the full primary;
  `after()` continuation writes the rest (test the engine's tiered return shape).
- **Circuit breaker:** opens after N consecutive 403/429, short-circuits during
  cooldown, half-opens after cooldown, closes on a success.
- **iTunes limiter:** concurrency never exceeds the (lowered) cap across
  simultaneous callers (extend `itunes-limit.test.ts`).
- **Client poller:** appends without duplicates, stops at target or after K idle
  polls.
- **gen-timing:** prints phase durations + `itunesCalls`/`spotifyCalls`.

## Out of scope

- The Settings popularity-graph / slider correctness (separate goal: copy tweak or
  UX redesign — deferred per this session's decision).
- Relaxing the playable-preview guarantee.
- A streaming (SSE) generate response — rejected (Q4 option ③) as a poor fit for the
  cache-backed, poll-based read model.
- A new preview provider (Deezer).

## Risks & mitigations

- **First batch can't fill 8 under external throttle** → blank/retry. Mitigation:
  breaker + volume cut make self-throttle rare; retry state is the existing
  fallback; `FIRST_BATCH_TARGET` is tunable down if coverage is thin.
- **`after()` continuation dies on serverless** → fill stalls. Mitigation: first
  batch is already painted; next `/feed` load resumes; Vercel Fluid Compute default
  timeout is 300s, ample.
- **Background poller races / duplicate cards** → dedup by `spotify_artist_id`;
  stop on idle.
- **Breaker too aggressive** → previews thin during a transient blip. Mitigation:
  half-open probe restores quickly; tune cooldown against `gen-timing` call counts.

# PRD: Fast first paint (3-5s) + preview-volume reduction

**Related design:** `docs/superpowers/specs/2026-06-06-fast-first-paint-design.md`
**Branch:** `feat/playable-previews` (folds into PR #139 — ships the previews work corrected)

## Problem Statement

After the guaranteed-playable-previews work, the feed and Explore got slow and the
app started throttling its own (single, shared) API keys. The user lands on `/feed`
and stares at a spinner for 20-35s (Explore 54-74s); the Settings "Regenerate Feed &
Explore" button hangs ~60s. Worse, a single regeneration can burst iTunes (HTTP 403)
and Spotify (HTTP 429, `retry-after ≈ 24h`) hard enough to block the shared
production key for a day.

## Solution

The user sees real, playable content within 3-5s (target 3s). A small first batch
(~8 cards) paints fast; the rest fills in the background while they review. The app
confirms previews only for the cards it actually shows, and a circuit breaker stops
preview lookups from ever bursting the shared keys into a multi-hour block. The hard
guarantee is kept: every card that renders has a playable preview.

## User Stories

1. As a returning listener, I want my feed to show real cards within ~3s, so that I
   don't stare at a spinner.
2. As a first-run user, I want onboarding to paint a first batch fast, so that the
   app feels alive immediately.
3. As a listener, I want every card I see to have a working preview, so that tapping
   play never no-ops.
4. As a listener reviewing cards one at a time, I want the next cards to be ready as
   I go, so that I never hit an empty stack.
5. As an Explore browser, I want rails to appear instantly (from cache) and refresh
   in the background, so that browsing isn't blocked on generation.
6. As a user tuning Settings, I want "Regenerate Feed & Explore" to return in a few
   seconds, so that the button isn't stuck for a minute.
7. As the operator, I want preview lookups to never burst the shared API keys into a
   24h block, so that one regeneration can't take production down.
8. As a developer, I want per-generation timing and API-call counts in the logs, so
   that I can verify the fix on a throttled box without healthy keys.
9. As a developer, I want preview confirmation to run only on shown cards, so that we
   stop doing ~36 confirmations to display 20.
10. As a user during an external provider outage, I want a clear retry state rather
    than dead play buttons, so that the app degrades honestly.

## Implementation Decisions

- **Pick-then-confirm-then-backfill.** Move preview confirmation out of
  `resolveArtistsByName` (which currently confirms every resolved artist) into the
  engine's pick stage: score → pick top N → confirm only those N → drop empties →
  backfill from the resolved pool, confirming only promoted artists.
- **Three-tier `generate`.** Tier 1 (blocking) confirms ~8 (`FIRST_BATCH_TARGET`,
  stop-at-target), writes them, returns `{phase:'first-batch'}`. Tiers 2/3 (rest of
  primary, secondary, colour) run in the existing `after()` block. (Design Q4 = ①
  early-return + `after()` continuation; streaming rejected.)
- **Client append-poller.** `FeedClient` reuses the loader's `GET
  /api/recommendations` poll to append new unseen cards (dedup by
  `spotify_artist_id`) until ~20 or K idle polls. (Q1=A real cards; Q2=A background
  append.)
- **Preview-source circuit breaker** (`lib/preview-source-breaker.ts`,
  closed→open→half-open). iTunes: concurrency 12→~5 + min-interval + breaker;
  Spotify: process-level "cold until `retry-after`" flag. Protects the shared key.
- **Explore**: per-rail confirm-only-shown; `buildExploreRails` returns cached rails
  immediately, `force` regen moves to `after()`; client polls to swap in fresh rails.
- **Settings button**: non-blocking — flip back when first batches are written.
- **Instrumentation**: fix the dropped `metrics` so `gen-timing` prints
  `firstBatch= primary= preview=`; add `itunesCalls= spotifyCalls=` counters.
  Success metric = call-count down **and** time-to-first-batch < 5s (target 3s).

## Testing Decisions

Test external behavior via injected dependencies, not internals. Prior art:
`confirm-previews.test.ts` already asserts `itunesCallCount`/`spotifyCallCount`;
`itunes-limit.test.ts` asserts concurrency caps.

- `confirm-previews`: confirming a picked list stops at target; confirms exactly the
  shown set (+ promoted), never the full pool.
- `preview-source-breaker`: opens after N 403/429, short-circuits during cooldown,
  half-opens after cooldown, closes on success.
- `engine`: tiered return writes the first batch and defers the rest.
- `itunes-limit`: concurrency never exceeds the lowered cap.
- `use-feed-fill`: appends without duplicates; stops at target/idle.
- `gen-timing`: prints phase durations + call counters.

## Out of Scope

- Settings popularity-graph / slider correctness (separate goal — copy or UX
  redesign, deferred).
- Relaxing the playable-preview guarantee.
- Streaming (SSE) generate responses.
- A new preview provider (Deezer).

## Further Notes

Single shared API keys across local/preview/prod mean wall-clock can't be measured on
a healthy environment until the current throttle decays. The robust, environment-
independent target is **request-count**, which the instrumentation slice makes
observable first — so it ships before everything else.

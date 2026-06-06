## Problem Statement

Some artist cards in flipside populate without a playable music preview. A user
scrolls the For You feed or an Explore rail, sees a card with a play control, taps
it — and nothing happens. The preview is missing because today's pipeline writes
cards with an empty `topTracks` list and resolves their previews **after** the
response, in a best-effort background job that races against the user. When that
job hasn't finished (or an artist's only tracks have null preview URLs), the card
renders with a dead, silently-failing play button. The result is an inconsistent,
trust-eroding experience: the user can't tell which cards will actually play.

## Solution

Every artist card that populates is **guaranteed playable**. A card is only
written to the cache (and therefore only shown) once it has at least one track
with a real preview URL. Artists with no preview available from any source are
**dropped** rather than shown with a dead button, and the feed/rail backfills
from the candidate pool so the card count holds. Preview tracks are confirmed
during artist resolution and **baked into the card's stored data**, so there's no
post-response race — the card ships with its preview already attached.

This must hold without regressing the current 3–5 second initial load. The
confirmation step is iTunes-first (free, no auth, near-universal 30s previews,
fast), runs under a shared concurrency limiter, and reuses the existing name
cache so warm loads pay almost nothing.

The guarantee applies to all three card surfaces: the For You feed, the four
Explore rails (adjacent / outside / wildcards / leftfield), and first-run /
onboarding generation. All three funnel through the same artist-resolution path,
so the fix lands in shared code.

## User Stories

1. As a listener, I want every artist card I see to have a working preview, so that I can actually hear an artist before deciding to follow them.
2. As a listener, I want the play button on a card to always produce sound, so that I never tap a dead control and lose trust in the app.
3. As a listener browsing the For You feed, I want each card to be immediately playable on render, so that I don't have to wait for a background fetch to "catch up."
4. As a listener browsing an Explore rail (adjacent, outside, wildcards, leftfield), I want every card in the rail to be playable, so that the curated discovery shelves feel finished, not half-loaded.
5. As a first-run user just past onboarding, I want my very first generated cards to be playable, so that my first impression of the app is that it works.
6. As a listener, I want cards with no available preview to simply not appear, so that I'm never shown a card I can't interact with.
7. As a listener, I want the feed to stay full (same number of cards), so that dropping un-playable artists doesn't leave me with a sparse, thin feed.
8. As a listener, I want each playable card to expose only tracks that actually play, so that I never hit a dead track even within a card that has some working previews.
9. As a listener on a slower connection, I want initial load to stay in the 3–5 second range, so that the playability guarantee doesn't make the app feel slow.
10. As a returning listener, I want repeat loads to be fast, so that previews confirmed on a prior visit are reused rather than re-fetched.
11. As a listener, I want the leftfield / long-tail rail to still surface obscure artists, so that the playability filter doesn't quietly collapse discovery into only mainstream acts.
12. As a listener who enables underground mode, I want playable cards that still respect the popularity cap, so that the preview guarantee and the obscurity promise coexist.
13. As a listener, I want previews to remain available even when Spotify's preview URL is null, so that artists Spotify won't preview still play via the iTunes fallback.
14. As the product owner, I want preview confirmation to be measured in the generation timing log, so that I can verify and tune the added cost against the load budget.
15. As the product owner, I want the iTunes lookups bounded by a shared concurrency limiter, so that promoting them toward the critical path can't storm the endpoint (the same failure mode as the prior leftfield Last.fm burst).
16. As the product owner, I want preview status cached so recurring artists aren't re-queried every generation, so that iTunes request volume stays low.
17. As a developer, I want preview confirmation isolated in a pure, injectable module, so that its branchy logic (iTunes hit, Spotify fallback, drop-when-empty, null filtering) can be unit-tested without network access.
18. As a developer, I want the drop-and-backfill behavior tested, so that a future change can't silently thin the feed below its target count.
19. As a developer, I want a defensive read-path filter, so that any legacy cache row written before this change (empty `topTracks`) can never render a dead card.
20. As a developer, I want the change to reuse existing structures (name cache, resolver, blocking/secondary pools) rather than add a parallel system, so that the codebase stays comprehensible.

## Implementation Decisions

**Guarantee definition.** An artist is "playable" iff, after confirmation, it has
≥1 track with a non-null preview URL. Only preview-bearing tracks are baked into a
card (null-preview tracks are filtered out), so every track in a shown card's strip
plays. iTunes is the primary source; Spotify top-tracks is the fallback for the
rare iTunes miss.

**Preview cache location — bake into `artist_data`.** Confirmed `topTracks` are
stored inside the `artist_data` blob already persisted in the `artist_search_cache`
name cache. This makes the name cache double as the preview cache:
- The For You engine copies the resolved artist (now carrying `topTracks`) into
  `recommendation_cache.artist_data` at write time.
- Explore rails hydrate card data from `artist_search_cache.artist_data`, so they
  inherit `topTracks` with no extra join.
- A name-cache hit carries its previews already — no re-fetch on warm loads.
- Negative caching is represented as a confirmed-but-empty `topTracks` array on the
  cached artist, so a recurring no-preview artist is dropped without re-querying
  iTunes. (Tradeoff accepted: previews share the row's lifetime rather than a
  separate TTL; iTunes preview URLs are stable, so this is low-risk. Periodic
  re-confirmation of empty entries is out of scope for v1.)
- Migration: legacy rows whose `artist_data` lacks a `topTracks` field are treated
  as unconfirmed and confirmed once on next encounter, then written back with the
  field.

**Preview-confirmation module (new, deep, pure).** A module that, given an
artist's name and id plus injected dependencies (cache read/write, iTunes search,
Spotify top-tracks), returns the artist's playable tracks or an empty list. Order:
cached `topTracks` present → use it; else iTunes search (under the limiter) → if
≥1 preview, use and cache; else Spotify top-tracks fallback → if ≥1 non-null
preview, use and cache; else cache empty (negative) and return empty. All I/O is on
injected deps so the module is unit-testable without network.

**Resolution integration + drop.** The shared resolver/caller path attaches
confirmed `topTracks` to each resolved artist and **drops** artists that confirm
empty, covering both the name-cache-hit path and the live-resolve path (cache hits
must be confirmed too, since they skip the live miss-worker). Dropped artists never
enter the candidate set, so they cannot be picked or written.

**Backfill to hold counts.** The For You pipeline already over-resolves (a blocking
pool larger than the displayed count) and picks the top N via the greedy diversity
pick. The preview filter is applied **before** the pick, so the top N is chosen
from playable survivors. If survivors fall below target, the existing secondary
resolve pool backfills. Explore rails apply the same pre-pick filter within their
existing per-rail resolve caps; their existing minimum-floor topup continues to
operate on playable picks. No new over-generation system is introduced; if real
coverage proves low, the mitigation is raising the existing blocking/resolve caps,
guided by the timing log.

**iTunes concurrency limiter (new).** A process-wide concurrency gate
(`runItunes`) mirroring the existing Last.fm limiter, with all iTunes calls routed
through it so the blocking set, secondary set, all four rails, and the per-artist
tracks endpoint share one budget. Prevents an iTunes request storm when
confirmation moves toward the critical path.

**Background prewarm — slim/remove.** With previews confirmed during resolution
and baked into the card, the existing background track-prewarm job becomes
redundant for resolved artists and is slimmed or removed. The background secondary
resolution and color extraction remain; the secondary resolution now also confirms
previews and bakes tracks via the same shared path.

**Timing instrumentation.** The generation timing log gains a `preview` phase
measuring confirmation wall-clock, so the added cost is observable and the limiter
/ resolve caps can be tuned against the 3–5s budget.

**Read-path defensive filter.** The feed and explore read paths skip any card whose
`topTracks` is empty, so a legacy/empty cache row written before this change can
never render a dead card. This is belt-and-braces on top of the drop-at-write
guarantee.

**Frontend.** No new UI is required. The existing silent "no preview" no-op,
"No tracks available" placeholder, and lazy per-artist track fetch remain as
safety nets but become unreachable for shown cards.

**Schema.** No migration required. `topTracks` lives inside the existing
`artist_data` JSON column of `artist_search_cache` (and is copied into
`recommendation_cache.artist_data`). The `artist_tracks_cache` table and the
per-artist tracks endpoint remain for the lazy safety-net path; the endpoint is
routed through the new iTunes limiter.

## Testing Decisions

Good tests here assert **external behavior**, not internals: given inputs and
faked dependencies, the module returns the right tracks / drops the right artists —
without asserting call order or private state. Network (iTunes, Spotify, Supabase)
is always injected as a fake, following the existing pattern in the resolver tests
(which pass an in-memory cache and stubbed search function) and the name-cache
tests (in-memory fake Supabase client).

Modules to be tested:
1. **Preview-confirmation module** (highest value) — covers: cached-tracks reuse;
   iTunes hit; iTunes-empty → Spotify fallback; both-empty → drop + negative-cache
   write; filtering out null-preview tracks; never throwing on a source failure
   (degrade to drop). Prior art: `resolve-candidates` tests, `artist-name-cache`
   tests.
2. **Drop + backfill logic** (highest value) — covers: no-preview artists removed
   before the greedy pick; survivors backfill to hold the target count; below-target
   falls through to the secondary pool. Prior art: existing engine/pipeline unit
   tests around `greedyPickTop` and the resolve pools.
3. **iTunes limiter** — covers: concurrency never exceeds the cap across
   simultaneous callers; slots transfer to waiters. Prior art: mirror of the
   Last.fm limiter behavior.
4. **Read-path defensive filter** — covers: a cache row with empty `topTracks` is
   never returned to the client / never renders a card.

## Out of Scope

- A Deezer preview provider (referenced in the track source enum but unimplemented).
- Reworking the per-artist tracks endpoint beyond routing its iTunes call through
  the new limiter.
- Any change to scoring/ranking other than applying the preview filter before the
  greedy pick.
- Periodic re-confirmation / TTL expiry of negative (no-preview) cache entries —
  empty entries persist for the cache row's lifetime in v1.
- New UI for an "unavailable preview" state — un-playable cards are dropped, not
  shown disabled.

## Further Notes

- Design doc: `docs/superpowers/specs/2026-06-05-guaranteed-playable-previews-design.md`.
- The 3–5s budget is verified via the generation timing log's new `preview` phase;
  expect near-zero added cost on warm loads (name-cache hits carry previews) and a
  small, tunable cost on cold loads.
- This builds on the recent leftfield perf fix; its lesson — bound bursty
  third-party fan-out with a shared concurrency limiter and use negative caching —
  is applied directly here to the iTunes calls.

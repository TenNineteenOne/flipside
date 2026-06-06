# Design: Guaranteed-playable artist cards

**Date:** 2026-06-05
**Status:** Approved (design); pending implementation plan
**Author:** flux + Claude

## Goal

Every artist card that populates must have a playable music preview, with **no
regression** to the current 3–5s initial load. The guarantee is *hard*: a card
that cannot be confirmed playable is **dropped**, not shown with a dead button.

Applies to all three card surfaces:

- **Feed** — `app/(app)/feed`, the main scrolling feed (top ~20 unseen artists).
- **Explore rails** — `app/(app)/explore`, the 4 themed rails (incl. leftfield).
- **Onboarding / first-run** — first generation, triggered client-side when a
  user lands on `/feed` with an empty cache (`RecommendationsLoader` → POST
  `/api/recommendations/generate`).

## Definition of "playable"

An artist is playable iff, after resolution, its `topTracks` contains **≥1 track
with a non-null `previewUrl`**. Only preview-bearing tracks are baked into the
card (tracks with `previewUrl === null` are filtered out), so every track in a
shown card's strip is guaranteed to play. iTunes is the primary source (free, no
auth, near-universal 30s previews); Spotify is the fallback (its `preview_url` is
nullable and unreliable).

## Root cause being fixed

Today, generation writes every candidate to `recommendation_cache` with
`topTracks: []` (always empty). Tracks — and their preview URLs — are resolved
**after** the response, in a best-effort background `after()` block
(`runTrackPrewarm`). A card therefore renders before (or without) its tracks,
and its play button silently no-ops (`lib/audio-context.tsx` returns early when
`!track.previewUrl`). The fix removes this race by confirming previews **during
resolution** and baking the tracks into the card at write time.

## Architecture

### 1. Injection seam: `confirmPreview` in the shared resolver

`resolveArtistsByName()` (`lib/recommendation/resolve-candidates.ts`) is the
single resolver used by the feed engine, every Explore rail
(`explore-engine.ts` → `resolveAndFilter`), and first-run generation. It already
fires an optional `enrichArtist` dependency **concurrently** with the per-artist
Spotify search and awaits it afterward.

Add a parallel optional dependency `confirmPreview(name): Promise<Track[]>` that:

- Fires **concurrently with** the Spotify search for the same artist (so
  per-artist wall-clock is `max(spotify, itunes)`, not the sum).
- Returns the preview-bearing tracks for that artist (iTunes-first, Spotify
  fallback), filtered to `previewUrl !== null`.
- When both the Spotify search and `confirmPreview` resolve, the resolver
  attaches `topTracks` to the `Artist` and **drops** the artist from the
  `resolved` map if `topTracks` is empty.

Because every surface funnels through this resolver, the guarantee is inherited
everywhere with one change.

`confirmPreview` resolution order per artist:

1. **Positive cache hit** — `artist_tracks_cache` row, fresh (<24h), non-empty →
   use cached tracks, no network call. *(Requires the resolved Spotify id; on a
   name-cache hit the id is known immediately, so the tracks-cache check happens
   before any iTunes call. On a name-cache miss, the Spotify search and iTunes
   search run concurrently and the tracks-cache is checked/written once the id
   is known.)*
2. **Negative cache hit** — fresh (<7d) `source:'none'` empty row → treat as
   known-no-preview, drop without re-querying.
3. **iTunes** (`searchTracksByArtist`, via the new limiter) → if ≥1 preview,
   upsert positive cache, keep.
4. **Spotify fallback** (`getArtistTopTracks`) → if ≥1 non-null `preview_url`,
   upsert positive cache, keep.
5. **Neither** → upsert negative cache (`source:'none'`, `tracks:[]`), drop.

### 2. Drop + backfill — keeping the feed full

The feed already over-resolves: `BLOCKING_RESOLVE_CAP = 36` blocking candidates
are resolved, then `greedyPickTop` selects the top 20 by score. The no-preview
**filter is applied before `greedyPickTop`**, so we pick the top 20 from
*survivors*. With ~85–95% iTunes coverage, 36→20 has ample headroom.

If survivors ever fall below the target (20), the already-firing **secondary
pool** (`SECONDARY_RESOLVE_CAP = 54`, fired concurrently, processed in
`after()`) backfills on the next read. No new over-generation machinery is
required; we lean on the existing two-tier split. If real-world coverage proves
lower than expected, the mitigation is to raise `BLOCKING_RESOLVE_CAP` (measured
against `[gen-timing]`), not to add a new fan-out.

Explore rails apply the same pre-pick filter within their existing per-rail caps
(e.g. `LEFTFIELD_RESOLVE_CAP = 48`).

### 3. iTunes rate-limiter (`lib/itunes-limit.ts`)

iTunes currently has **no** concurrency gate (`lib/music-provider/itunes.ts`).
Moving it onto the critical path for the blocking set plus 4 rails would storm
the endpoint — the same failure mode as the recently-fixed leftfield Last.fm
burst. Add `lib/itunes-limit.ts` mirroring `lib/lastfm-limit.ts`: a shared
~12-concurrent gate (`runItunes<T>(fn)`), and route **every** iTunes call
through it so all callers (blocking set, secondary, all rails, the per-artist
tracks endpoint) share one budget.

### 4. Caching + negative caching

Reuse the existing `artist_tracks_cache` table (keyed by `spotify_artist_id`):

- **Positive cache:** unchanged — `tracks` jsonb, `source` text, `fetched_at`.
  TTL 24h.
- **Negative cache:** a row with `source:'none'` and `tracks:'[]'`, TTL **7
  days** (no-preview status changes slowly; avoids re-hitting iTunes for the
  same recurring Last.fm similar-artist every generation).

**No schema migration required** — the existing `tracks jsonb` / `source text`
columns carry the negative marker; the semantics (treat fresh empty `source:none`
as "drop, don't re-query") live in code. Read logic distinguishes:

- row absent or stale → resolve fresh
- fresh + non-empty → positive hit, keep
- fresh + empty + `source:'none'` → negative hit, drop

### 5. Slim the redundant background prewarm

With tracks baked in during resolution, `runTrackPrewarm()` (in the `after()`
block of `app/api/recommendations/generate/route.ts`) is redundant for resolved
artists. **Slim or remove it.** The `after()` block keeps:

- `runSecondary()` — secondary-pool resolution (now also preview-confirms and
  bakes tracks, via the shared resolver).
- `runColorExtraction()` — unchanged.

This *removes* a parallel track-fetching system rather than adding one. The
secondary resolution's results, written to `recommendation_cache` in `after()`,
now carry baked `topTracks` just like the primary set.

### 6. Frontend — defensive only

These existing paths stay as safety nets but become unreachable for shown cards:

- `lib/audio-context.tsx` silent `if (!track.previewUrl) return`.
- `components/feed/artist-card.tsx` "No tracks available" placeholder.
- `components/feed/track-strip.tsx` `if (tracks.length === 0) return null`.
- `lib/hooks/use-artist-tracks.ts` lazy fetch + `/api/artists/[id]/tracks`.

Add **one** light defensive read-path filter (feed + explore reads of
`recommendation_cache`) that skips any card whose `topTracks` is empty, so a
legacy/empty cache row written before this change can never render a dead card.

## Performance plan & verification

- The only net-new **critical-path** cost is `confirmPreview` for the blocking
  primary set, overlapped with the Spotify search it runs alongside. Secondary
  and rail-deferred work stays off the critical path.
- Extend `[gen-timing]` (`lib/recommendation/gen-timing.ts`) with a `preview=`
  phase measuring iTunes-confirmation wall-clock, so the added cost is directly
  observable and the iTunes limiter / `BLOCKING_RESOLVE_CAP` can be tuned
  against the 3–5s budget.
- Manual browser check on `/feed` and `/explore` once dev Last.fm/Spotify keys
  recover from prior rate-limiting, confirming the real load number.

## Testing

- **Drop/backfill filter:** artists with zero preview-bearing tracks are removed
  before `greedyPickTop`; survivors fill to target; below-target falls back to
  secondary.
- **`confirmPreview` concurrency:** runs alongside (not after) the Spotify
  search; resolver attaches `topTracks` and drops empties.
- **Negative cache:** fresh `source:'none'` row → drop without network call;
  stale → re-resolve; positive fresh → reuse.
- **iTunes limiter:** concurrency never exceeds the cap across simultaneous
  callers.
- **Read-path defense:** a `recommendation_cache` row with empty `topTracks` is
  never returned to the client.
- **Track filtering:** only `previewUrl !== null` tracks are baked into a card.

## Risks & mitigations

- **iTunes coverage lower than assumed** → feed thins. Mitigation: secondary
  backfill; raise `BLOCKING_RESOLVE_CAP` guided by `[gen-timing]`.
- **iTunes latency/timeouts on the critical path** → load creeps up. Mitigation:
  shared limiter + existing 8s per-call timeout + measured `preview=` phase;
  iTunes runs overlapped with Spotify, so only the slow tail adds time.
- **iTunes rate-limiting / wrong-artist name matches** → pre-existing behavior
  (exact artist-name filter in `itunes.ts`); limiter reduces burst risk.
- **Negative-cache staleness** (Apple later adds a preview) → 7-day TTL bounds
  it; acceptable.

## Out of scope

- A Deezer provider (referenced in the `Track.source` enum but unimplemented).
- Reworking the per-artist `/api/artists/[id]/tracks` endpoint beyond routing it
  through the new iTunes limiter.
- Any change to scoring/ranking other than applying the preview filter before
  `greedyPickTop`.

---
title: Music Providers & Resilience
updated: 2026-10-24
related: [[external-apis]], [[generation-engine]], [[spotify-dependency]], [[api-routes]]
---

# Music Providers & Resilience

The adapters between the engines and external music data, plus the circuit breakers /
limiters that keep one generation from self-DDoSing the shared keys. For the services
themselves see [[external-apis]]; for the Spotify-removal analysis see [[spotify-dependency]].

There is **no `MusicProvider` interface** any more (#175 E2). Each upstream has one
honestly named adapter module; nothing "Spotify" does Last.fm work.

## Module layering (#175 E3)

Imports point one way (verified by an import scan; no folder- or file-level cycles):

```
app/ ─▶ lib/cards, lib/client ─▶ lib/recommendation
lib/recommendation ─▶ lib/lastfm · lib/music-provider · lib/artist-identity
lib/history        ─▶ lib/lastfm · lib/artist-identity
lib/artist-identity ─▶ lib/lastfm · lib/music-provider (types only)
lib/lastfm         ─▶ lib/limiter · lib/metrics · lib/supabase
lib/music-provider ─▶ lib/itunes-limit (→ lib/limiter) · lib/metrics · lib/preview-source-breaker
```

## Last.fm — `lib/lastfm/` (the one Last.fm adapter)

`index.ts` exports `createLastfm(deps?)` and the production instance `lastfm`. It owns the
API key (read at call time), the base URL, per-endpoint timeouts, the shared gate, the
`lastfm_cache` read-through and the per-endpoint live-call counters. Every request is
byte-identical to the pre-#175 fetchers.

| Op | Endpoint | Timeout | Cache | Key missing |
|---|---|---|---|---|
| `tagTopArtists(tag, limit=20)` | `tag.gettopartists` (as-is, then hyphens→spaces retry on empty) | 5s | 7d; empties 12h | `[]` (negative-cached) |
| `similarArtists(name)` | `artist.getSimilar&limit=50` | 8s | 7d; empties not cached | warn once, `[]` |
| `artistInfo(name)` | `artist.getInfo&autocorrect=1` | 6s | 7d; not-found (error 6) 12h; transient never | `null`, no cache read |
| `searchArtists(q, limit=10)` | `artist.search` | 8s | 7d; empties 12h | `[]` (negative-cached) |
| `userArtistNames(user)` | `user.getTopArtists` + `user.getRecentTracks` (200 each) | 8s | none | throws |
| `hasKey()` | — | — | — | `false` |

Deps (`apiKey`, `fetch`, `limiter`, `cache`) are injectable; `lib/lastfm/index.test.ts`
covers key-missing, timeouts, gate/counters and cache read-through with fakes. Integration
tests swap the whole adapter for `lib/recommendation/__fixtures__/fake-lastfm.ts`.

Supporting files: `cache.ts` (Supabase `lastfm_cache`: 7-day positive, 12h negative,
in-process in-flight dedup), `limit.ts` (`runLastfm`), `types.ts` (`SimilarArtistRef`,
`ArtistEnrichment`, `LastfmArtistCandidate`).

Doorway wiring lives in `lib/artist-identity/lastfm-lookup.ts`: `lastfmResolve` (getInfo as
the name resolver), `buildEnrichArtist` (undefined without a key, so callers feature-detect),
`mergeEnrichment`, and `pickBestMatch`/`searchAndMatchArtist` (search match guard; no
production caller today).

## Spotify — `lib/music-provider/spotify.ts` (client-credentials only)

The user-token surface is gone (restore tag `archive/spotify-user-token`). Two functions:

- `getSpotifyTopTracks(token, spotifyId, limit, market)` — the preview fallback after
  iTunes, wired in `livePlayablePorts` (`playable-candidates.ts`); keyed on the Spotify
  id, no-op without an id or token.
- `searchSpotifyArtists(token, query)` — returns `RateLimited` on 429 / open breaker; used
  only by `scripts/seed-artist-cache.ts`.

The token is `getSpotifyClientToken()` (`lib/spotify-client-token.ts`: in-memory cache,
in-flight dedup), fetched by the generate route and `loadExploreInput`. `RateLimited` /
`isRateLimited` stay in `lib/music-provider/index.ts`.

## iTunes — `lib/music-provider/itunes.ts`

`itunesFetch` owns iTunes HTTP; `searchTracksByArtist(name, market, limit)` returns `null`
on breaker-open / failure, `[]` on zero matches (callers must distinguish).

### Key types (`lib/music-provider/types.ts`)
- `Artist.id` is the internal **uuid** (`artists.id`); `spotifyId` is an optional attribute.
- `Track.source` is `'itunes' | 'spotify' | 'deezer'` — `deezer` is forward-declared only.
- `Artist.topTracks`: `undefined` = unconfirmed, `[]` = negative cache, `[…]` = confirmed.

## Circuit breakers & limiters

| Mechanism | File | Behavior |
|---|---|---|
| `spotifyBreaker` | `preview-source-breaker.ts` (instance in `spotify.ts`) | threshold 5 failures, 60s cooldown; honors `Retry-After` via `openUntil()` (can be ~24h on a credential ban). When open, search returns `{rateLimited, skipRetry}` and top-tracks returns `[]`. |
| `itunesBreaker` | instance in `itunes.ts` | threshold 5, 60s; trips on 403/429/timeout; returns `null` so callers fall back to Spotify. |
| `createLimiter` | `lib/limiter.ts` | the generic gate (token bucket / min interval / concurrency) behind both limiters below. |
| iTunes gate | `itunes-limit.ts` | max 5 concurrent, 50ms min spacing. |
| `runLastfm` | `lib/lastfm/limit.ts` | ~20 req/s bucket (50 burst), max 12 concurrent. |
| MusicBrainz limiter | `lib/artist-identity/musicbrainz.ts` (`createMbLimiter`) | 1 req/s for the #159 backfill. |
| `api-call-counter.ts` | `lib/metrics/` | measurement only (iTunes / Spotify / Last.fm per endpoint), not a throttle. |
| `rate-limiter.ts` | — | **login** IP rate-limit (unrelated to music APIs). |
| onboarding search limiter | `app/api/onboarding/search` | in-memory 120/min per user (per serverless instance). |

`PreviewSourceBreaker.openUntil(ts)` always takes the **max** of current and new expiry — a
shorter retry-after can never shorten an open window.

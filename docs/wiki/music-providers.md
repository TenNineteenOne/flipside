---
title: Music Providers & Resilience
updated: 2026-06-06
related: [[external-apis]], [[generation-engine]], [[spotify-dependency]], [[api-routes]]
---

# Music Providers & Resilience

The abstraction layer between the engine and external music data, plus the circuit
breakers / limiters that keep one generation from self-DDoSing the shared keys. For the
services themselves see [[external-apis]]; for the Spotify-removal analysis see
[[spotify-dependency]].

## The `musicProvider` abstraction (`lib/music-provider/`)

`index.ts` defines the `MusicProvider` interface; `provider.ts` exports a single
process-global singleton:

```ts
export const musicProvider: MusicProvider = new SpotifyProvider()
```

There is **no runtime provider switching** today — swapping providers means a new class
implementing the interface (this is what makes the [[spotify-dependency]] resilience work
feasible). Interface methods: `getTopArtists`, `getUserMarket`, `getRecentlyPlayed`,
`getArtists` (batch, *defined but unused*), `getSimilarArtistNames` (**Last.fm only**),
`searchArtists`, `getArtistTopTracks`, `createPlaylist`/`addTracksToPlaylist`/`likeTrack`.

### Key types (`types.ts`)
- `Artist.id` is **always a Spotify artist ID** — the universal namespace (and the hard
  dependency; see [[data-model]]).
- `Track.source` is `'itunes' | 'spotify' | 'deezer'` — **`deezer` is forward-declared
  with zero implementation** (a slot for keyless providers).
- `Artist.topTracks`: `undefined` = unconfirmed, `[]` = negative cache, `[…]` = confirmed.

### `SpotifyProvider` (`spotify-provider.ts`, ~14KB)
Implements every method via the Spotify Web API — **except `getSimilarArtistNames`, which
calls Last.fm** (`artist.getSimilar`, 7-day cached). The name is historical; Last.fm is the
real similarity engine.

### `itunes.ts`
`searchTracksByArtist(name, market, limit)` — standalone (not on the interface), called
directly by [[generation-engine]] preview confirmation. Returns `null` on breaker-open /
failure, `[]` on zero matches (callers must distinguish).

## Tokens (two distinct Spotify credentials)

| Token | Source | Powers |
|---|---|---|
| **User OAuth** | encrypted in NextAuth JWT, via `getAccessToken` | history sync, like-a-track, preferred for generation |
| **Client-credentials** | `SPOTIFY_CLIENT_ID/SECRET` → `spotify-client-token.ts` (in-memory cache, in-flight dedup) | onboarding search, ID resolution, generation fallback |

Generation uses `userAccessToken ?? clientToken`. The client-credentials key is the
**throttle-prone, shared** one (the repurposed "Home Assistant" app; **one app per account
is the Spotify limit now**, so a separate dev key isn't possible). See [[spotify-dependency]].

## Circuit breakers & limiters

| Mechanism | File | Behavior |
|---|---|---|
| `spotifyBreaker` | `preview-source-breaker.ts` (instance in `spotify-provider.ts`) | threshold 5 failures, 60s cooldown; honors `Retry-After` via `openUntil()` (can be ~24h on a credential ban). When open, `searchArtists` returns `{rateLimited, skipRetry}` so callers skip backoff. |
| `itunesBreaker` | instance in `itunes.ts` | threshold 5, 60s; trips on 403/429/timeout; returns `null` so callers fall back to Spotify. |
| `runItunes` | `itunes-limit.ts` | max 5 concurrent, 50ms min spacing. |
| `runLastfm` | `lastfm-limit.ts` | max 12 concurrent (no spacing). |
| `lastfm-cache.ts` | — | Supabase read-through (`lastfm_cache`): 7-day positive, 12h negative; in-process in-flight dedup. |
| `api-call-counter.ts` | — | measurement only (`incItunes`/`incSpotify`), not a throttle. |
| `rate-limiter.ts` | — | **login** IP rate-limit (unrelated to music APIs). |
| onboarding search limiter | `app/api/onboarding/search` | in-memory 120/min per user (per serverless instance; not multi-instance-safe). |

`PreviewSourceBreaker.openUntil(ts)` always takes the **max** of current and new expiry — a
shorter retry-after can never shorten an open window.

## Dead / unused
`getArtists` (batch), `createPlaylist`, `addTracksToPlaylist` are on the interface but have
zero call sites in the app. `chain-walker` multi-hop is unused (see [[generation-engine]]).

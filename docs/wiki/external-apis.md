---
title: External APIs
updated: 2026-11-23
related: [[music-providers]], [[spotify-dependency]], [[generation-engine]], [[api-routes]]
---

# External APIs

Every external service flipside talks to, and exactly what it provides. Breakers/limiters
are in [[music-providers]]; the replaceability analysis is in [[spotify-dependency]].

## Last.fm — the recommendation brain
Auth: `LASTFM_API_KEY` (public read-only, no OAuth). Every call goes through the one
adapter, `lib/lastfm` (`lastfm.*`): key, timeouts, the `runLastfm` gate (12 concurrent,
~20 req/s, 200 burst), the Supabase `lastfm_cache` read-through (with a batched prefetch) and per-endpoint counters. See
[[music-providers]].

| Endpoint | Used for | Adapter op → callers |
|---|---|---|
| `artist.getSimilar` | **similar artists** (the discovery graph) | `similarArtists` → `engine.ts` |
| `tag.gettopartists` | top artists per genre tag (seeds, bleed, far pool) | `tagTopArtists` → `engine.ts`, `far-picks.ts` |
| `artist.getInfo` | doorway name resolve + **genres / listener-count→popularity** | `artistInfo` → `artist-identity/lastfm-lookup.ts`, `history/id-resolver.ts` |
| `artist.search` | onboarding typeahead | `searchArtists` → `app/api/onboarding/search` |
| `user.getTopArtists`, `user.getRecentTracks` | listening history (opt-in) **with real play counts** (#215) | `userArtistPlays` → `history/lastfm-syncer.ts` |

**Play counts (#215).** `listened_artists.play_count` holds the source's real count, so the
Feed's "played more than 5 times" filter works after one sync. Last.fm: the all-time
`playcount` of each of the top 200 artists; an artist only in the last 200 recent tracks gets
the number of those tracks. stats.fm: `streams`, when it is a number. `ingestListens` stores
the count on insert and only ever **raises** an existing row to it (guarded `play_count < n`
UPDATE; the 23505 conflict fallback does the same), so rows that held the old per-sync counts
correct themselves on the next sync and two sources never lower each other. A source with no
count (stats.fm `streams: null`) keeps the old behaviour: 1 on insert, +1 per sync
(`rpc_bump_listened_play_counts`). When the resolver merges a name-only row into an existing
artist row it keeps the higher count (it used to add them). Id/name lists go out 200 per
request (#222).

> Last.fm **artist images are dead** (placeholder star since years ago; confirmed still
> true 2026) and its license excludes images — images come from Spotify today.

## iTunes / Apple — preview audio (primary)
Auth: **none** (free, keyless). All HTTP via `itunesFetch`; gated by the iTunes limiter + `itunesBreaker` (the `/api/open` link resolver passes `gateOnly`: limiter only, no breaker, no call counter).

| Endpoint | Used for | Where |
|---|---|---|
| `search?entity=song` | **30s preview URLs** (primary source) | `itunes.ts:searchTracksByArtist` |
| `search?entity=musicArtist` | Apple Music artist URL resolution (an answered no-match is cached as NULL for 30 days; an http/network/parse failure falls back to the search URL and caches nothing) | `lib/external-links.ts` (`linkFor`) |

Known pain point: ~20 req/min soft limit with erratic **403** throttling (per-IP, so prod's
Vercel IP differs from local) and no `Retry-After`. The official Apple Music API needs a
paid developer JWT.

## Spotify Web API
**Client-credentials only** — login is username-only and the user-token surface (history,
like, save→playlist, OAuth) was deleted in #175 (restore tag `archive/spotify-user-token`).
Adapter: `lib/music-provider/spotify.ts`. See [[spotify-dependency]] for the 2026 API gutting.

| Endpoint | Used for | Where | Degrades? |
|---|---|---|---|
| `/artists/{id}/top-tracks` | preview fallback after iTunes | `getSpotifyTopTracks` via `livePlayablePorts` | no Spotify id / token → skipped; ⚠️ likely removed for client-creds in Feb 2026 |
| `/search?type=artist` | name → Spotify id + image | `searchSpotifyArtists`, **only** `scripts/seed-artist-cache.ts` | generation resolves names via Last.fm since #157 |
| `accounts.spotify.com/api/token` | client-credentials token | `lib/spotify-client-token.ts` | null token → Spotify fallback skipped |

> ⚠️ As of **Feb 2026** Spotify removed `popularity`/`followers` from the artist object,
> deprecated `genres`, nulled `preview_url` for client-creds, and removed related-artists /
> recommendations / audio-features / batch-get-artists / top-tracks for non-extended-quota
> apps. So `/search` now returns essentially **ID + name + image**. See [[spotify-dependency]].

## stats.fm — optional history
Auth: none (public per-username). `GET /api/v1/users/{username}/top/artists?range=lifetime`.
Items often embed `artist.spotifyIds[]`, so many map to Spotify IDs without a search.
Each item's `streams` (lifetime plays; null when stats.fm has no imported history for the
user) is stored as the play count, see Last.fm above.
8s timeout, no breaker. `lib/history/statsfm-syncer.ts` → `ingestListens`.

## Researched but NOT integrated (candidates)
See `docs/_sweeps/research-*.md` and [[spotify-dependency]]:
- **Deezer** — keyless search + `nb_fan` popularity + images + 30s previews + `/related`.
  ToS: non-commercial, no image caching, expiring preview URLs.
- **MusicBrainz** — keyless (1 req/s, User-Agent required); url-rels return an artist's
  **Spotify URL** → recover the Spotify ID without the Spotify API.
- **ListenBrainz**, **TheAudioDB**, **Discogs**, **Wikidata/Commons** — secondary.

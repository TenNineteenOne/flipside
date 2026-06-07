---
title: External APIs
updated: 2026-06-06
related: [[music-providers]], [[spotify-dependency]], [[generation-engine]], [[api-routes]]
---

# External APIs

Every external service flipside talks to, and exactly what it provides. Breakers/limiters
are in [[music-providers]]; the replaceability analysis is in [[spotify-dependency]].

## Last.fm — the recommendation brain
Auth: `LASTFM_API_KEY` (public read-only, no OAuth). Concurrency-gated (`runLastfm`, 12),
Supabase-cached (`lastfm_cache`).

| Endpoint | Used for | Where |
|---|---|---|
| `artist.getSimilar` | **similar artists** (the discovery graph) | `spotify-provider.getSimilarArtistNames`, `chain-walker` |
| `tag.gettopartists` | top artists per genre tag (rails, seeds) | `engine.ts`, `explore-engine.ts` |
| `artist.getInfo` | **genres + listener-count→popularity** enrichment | `enrich-artist.ts` |
| `user.getTopArtists`, `user.getRecentTracks` | listening history (opt-in) | `history/lastfm-syncer.ts` |

> Last.fm **artist images are dead** (placeholder star since years ago; confirmed still
> true 2026) and its license excludes images — images come from Spotify today.

## iTunes / Apple — preview audio (primary)
Auth: **none** (free, keyless). Gated by `runItunes` + `itunesBreaker`.

| Endpoint | Used for | Where |
|---|---|---|
| `search?entity=song` | **30s preview URLs** (primary source) | `itunes.ts:searchTracksByArtist` |
| `search?entity=musicArtist` | Apple Music artist URL resolution | `api/open/apple_music` |

Known pain point: ~20 req/min soft limit with erratic **403** throttling (per-IP, so prod's
Vercel IP differs from local) and no `Retry-After`. The official Apple Music API needs a
paid developer JWT.

## Spotify Web API
Two credentials — see [[music-providers]] for token details and [[spotify-dependency]] for
the 2026 API gutting. What flipside uses:

| Endpoint | Token | Used for | Degrades? |
|---|---|---|---|
| `/search?type=artist` | client-creds or user | resolve name → **ID + image** | onboarding falls back to `artist_search_cache` ILIKE on 429 |
| `/artists/{id}/top-tracks` | user | preview fallback | iTunes tried first; ⚠️ likely removed for client-creds in Feb 2026 |
| `/me/top/artists`, `/me/player/recently-played`, `/me` | user | history + market (opt-in) | Last.fm / stats.fm are alternates |
| `/search?type=track`, `/artists/{id}` | user | resolve iTunes track → Spotify ID (for "like") | hard fail |
| `PUT /me/tracks` | user | like a track | hard fail |
| `/users/:id/playlists`, `/playlists/:id/tracks` | user | save→playlist (optional) | returns `playlistError`, save still succeeds |
| OAuth `/authorize`,`/api/token` | — | optional Spotify connect + token refresh | — |

> ⚠️ As of **Feb 2026** Spotify removed `popularity`/`followers` from the artist object,
> deprecated `genres`, nulled `preview_url` for client-creds, and removed related-artists /
> recommendations / audio-features / batch-get-artists / top-tracks for non-extended-quota
> apps. So `/search` now returns essentially **ID + name + image**. See [[spotify-dependency]].

## stats.fm — optional history
Auth: none (public per-username). `GET /api/v1/users/{username}/top/artists?range=lifetime`.
Items often embed `artist.spotifyIds[]`, so many map to Spotify IDs without a search.
8s timeout, no breaker. `lib/statsfm-listened-artists.ts`.

## Researched but NOT integrated (candidates)
See `docs/_sweeps/research-*.md` and [[spotify-dependency]]:
- **Deezer** — keyless search + `nb_fan` popularity + images + 30s previews + `/related`.
  ToS: non-commercial, no image caching, expiring preview URLs.
- **MusicBrainz** — keyless (1 req/s, User-Agent required); url-rels return an artist's
  **Spotify URL** → recover the Spotify ID without the Spotify API.
- **ListenBrainz**, **TheAudioDB**, **Discogs**, **Wikidata/Commons** — secondary.
- `scripts/mb-coverage-spike.ts` is a research spike only (not production).

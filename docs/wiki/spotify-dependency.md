---
title: Spotify Dependency — Analysis
updated: 2026-11-23
related: [[music-providers]], [[external-apis]], [[generation-engine]], [[data-model]]
sources: docs/_sweeps/research-A-deezer-apple.md, research-B-musicbrainz-lastfm.md, research-C-spotify-state.md
---

# Spotify Dependency — Analysis

> **Status 2026-11-23 (#217): the app no longer calls the Spotify API at all.** The preview
> fallback (`lib/music-provider/spotify.ts`), the client token (`lib/spotify-client-token.ts`)
> and `scripts/seed-artist-cache.ts` are deleted; `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`
> are unused and can be removed from Vercel. What is left is data only: `artists.spotify_id`
> (from MusicBrainz) for the "Open in Spotify" link. Everything below is history.

> **Status 2026-10-24 (#175):** much of this analysis has been acted on. Login is
> username-only; the Spotify **user-token** surface (history, like, save→playlist, OAuth)
> is deleted (restore tag `archive/spotify-user-token`). Generation resolves names via
> Last.fm `artist.getInfo` through the identity doorway (#157), and identity is an internal
> uuid with `spotify_id` as an attribute (ADR-0001), backfilled by the MusicBrainz worker
> (#159). What remains on Spotify: the client-credentials **top-tracks preview fallback**
> (`lib/music-provider/spotify.ts`) and Spotify search in `scripts/seed-artist-cache.ts`.
> The table below is the original 2026-06 analysis with the "already replaced" column
> updated; the rest of the old analysis (ID-migration options, Deezer direction) was cut on
> 2026-11-22 because that work is done. The plan that carried it out is archived at
> `docs/archive/spotify-removal-plan.md` (historical).

## What Spotify gives flipside (and the alternative that already exists)

| Capability | Spotify endpoint | Load-bearing? | Already replaced in-code? |
|---|---|---|---|
| Similar / related artists | *(none — Last.fm)* | yes | **Yes** — 100% Last.fm `artist.getSimilar` |
| Genres | `/search`, `/artists` | yes (scoring/filter) | **Yes** — Last.fm `artist.getInfo` (`lib/lastfm`); Spotify genres now deprecated anyway |
| Popularity (0–100) | artist object | yes (scoring) | **Yes** — Last.fm listeners → `scaleListeners`; Spotify popularity **removed Feb 2026** |
| Preview audio | `/artists/{id}/top-tracks` | yes | **Yes** — iTunes is primary; Spotify preview likely dead for client-creds |
| Artist **search** (name → ID + image) | `/search?type=artist` | no (seed script only) | **Yes** — Last.fm getInfo via the doorway (#157); onboarding uses Last.fm `artist.search` (#156) |
| Artist **image** | artist object | no (display) | **No** — comes with the search result |
| Artist **Spotify ID** | every response | open-link only | **Yes** — internal uuid identity (ADR-0001); `spotify_id` backfilled from MusicBrainz url-rels (#159) |
| "Open in Spotify" link | `open.spotify.com/artist/{id}` | no (navigation) | n/a — zero-API once the ID is known |
| User history (opt-in) | `/me/top`, `/me/recent` | no | **Removed** — Last.fm / stats.fm only |
| Like a track / save→playlist | `/me/tracks`, playlists | no | **Removed** with the user-token surface (#175) |

**Bottom line:** nothing in sign-in, onboarding or generation needs the Spotify API. With
`SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` unset, `getSpotifyClientToken()` returns `null`
(`lib/spotify-client-token.ts`) and the app runs on iTunes previews alone; only
`scripts/seed-artist-cache.ts` cannot resolve new names.

## The Feb 2026 Spotify API reality (High confidence — see research-C)

Spotify gutted the Web API for non-extended-quota apps:
- **Removed** `popularity` and `followers` from the artist object; **deprecated** `genres`.
- **`preview_url` is null** for client-credentials apps.
- **Removed** related-artists, recommendations, audio-features, batch-get-artists, and
  artist top-tracks for non-extended-quota apps.
- Dev mode further restricted (user cap 25→5; owner must hold Premium); extended quota
  requires a registered org with 250K MAU — inaccessible to indie projects.

So Spotify `/search` now returns roughly **ID + name + image** — and that is the entire
remaining value. ⚠️ This implies parts of the current code (Spotify top-tracks fallback,
`getArtists` batch) **may already be dead in prod** — verify in runtime logs.

## What Spotify is still used for
- **Preview fallback**: `getSpotifyTopTracks` in `lib/music-provider/spotify.ts`, tried after
  iTunes, with the shared client-credentials key. See [[music-providers]].
- **Seeding script**: `scripts/seed-artist-cache.ts` resolves new names with Spotify search.
- **"Open in Spotify"**: a link built from `artists.spotify_id`, or a Spotify search URL when
  there is none (`lib/music-links.ts`); no API call. The id is an
  attribute, not a key: identity is the internal uuid (ADR-0001, [[data-model]]) and the
  MusicBrainz backfill cron fills `spotify_id` ([[infra-and-ops]]).

---
title: Spotify Dependency — Analysis
updated: 2026-06-06
related: [[music-providers]], [[external-apis]], [[generation-engine]], [[data-model]]
sources: docs/_sweeps/research-A-deezer-apple.md, research-B-musicbrainz-lastfm.md, research-C-spotify-state.md
---

# Spotify Dependency — Analysis

Answers: **what does flipside actually use the Spotify API for, and how replaceable is
each use?** Motivation: the shared client-credentials key (the repurposed "Home Assistant"
app; one-app-per-account limit) is throttle-prone and, when banned, empties cold-user feeds
and breaks onboarding search. See [[music-providers]] and the resilience goal.

> An accompanying **implementation plan** (verified with live API calls + pressure-tested)
> is tracked separately — see `docs/spotify-removal-plan.md` once written.

## What Spotify gives flipside (and the alternative that already exists)

| Capability | Spotify endpoint | Load-bearing? | Already replaced in-code? |
|---|---|---|---|
| Similar / related artists | *(none — Last.fm)* | yes | **Yes** — 100% Last.fm `artist.getSimilar` |
| Genres | `/search`, `/artists` | yes (scoring/filter) | **Yes** — Last.fm `artist.getInfo` (`enrich-artist.ts`); Spotify genres now deprecated anyway |
| Popularity (0–100) | artist object | yes (scoring) | **Yes** — Last.fm listeners → `scaleListeners`; Spotify popularity **removed Feb 2026** |
| Preview audio | `/artists/{id}/top-tracks` | yes | **Yes** — iTunes is primary; Spotify preview likely dead for client-creds |
| Artist **search** (name → ID + image) | `/search?type=artist` | yes | **No** — the one live generation dependency |
| Artist **image** | artist object | no (display) | **No** — comes with the search result |
| Artist **Spotify ID** | every response | yes (DB key + open-link) | **No** — the deepest tie (see below) |
| "Open in Spotify" link | `open.spotify.com/artist/{id}` | no (navigation) | n/a — zero-API once the ID is known |
| User history (opt-in) | `/me/top`, `/me/recent` | no | Last.fm / stats.fm alternates exist |
| Like a track / save→playlist | `/me/tracks`, playlists | no | Spotify-only feature (drop or keep behind connect) |

**Bottom line:** generation already leans on Last.fm + iTunes for everything *except* (1)
resolving a name to an artist (ID + image) and (2) the Spotify **ID** itself.

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

## The two real dependencies

### 1. Name → artist resolution (search)
Replaceable by **Deezer** (keyless `GET api.deezer.com/search/artist` → id, name, picture,
`nb_fan` popularity, link) or **MusicBrainz** search. Deezer also gives `/artist/{id}/related`
(similar) and 30s previews. Caveats: Deezer ToS is **non-commercial**, **images can't be
cached**, and **preview URLs expire** (hours) — must fetch fresh. See research-A.

### 2. The Spotify artist ID (DB primary key + open-link)
This is the hardest tie — `spotify_artist_id` keys nearly every table ([[data-model]]).
Two paths:
- **Keep Spotify IDs, source them without the API.** **MusicBrainz url-rels**
  (`/ws/2/artist/{mbid}?inc=url-rels`) return the artist's Spotify URL keyless
  (worked example: Nirvana → real ID). Keyless, 1 req/s, User-Agent required. Coverage is
  great for mainstream, uneven long-tail (research-B).
- **Fall back to a search URL** when no ID: `open.spotify.com/search/{name}` keeps the user
  in Spotify with zero API (lands on search, not the profile).

A *full* migration off Spotify IDs (e.g. to MBID or Deezer ID as the key) is a larger
schema change; the cheaper move keeps the Spotify-ID column but stops *requiring* the
Spotify API to fill it.

## Where Spotify is still needed or nice-to-have
- **Optional user connect** (history sync, like-a-track, save→playlist) — keep behind the
  opt-in OAuth token; it never touches the shared client-creds key, so it doesn't add
  ratelimit risk to cold users.
- **"Open in Spotify"** as the default outbound platform — keep, via stored/MusicBrainz ID
  or search-URL fallback.
- **Spotify image quality** — Spotify images are good and free *with* the search result; if
  search moves to Deezer, images come from Deezer (can't be cached) or Wikidata/Commons.

## Direction (for the plan)
Add **Deezer** + **MusicBrainz** providers behind the [[music-providers]] `musicProvider`
abstraction; use them as the default search/metadata path (and as fallback when the Spotify
breaker is open); keep iTunes primary for previews; keep Spotify only for the optional
user-connect features and the open-link. Also **debounce `/api/onboarding/search`** (fires
per keystroke today). Target: ratelimit risk from the shared Spotify key → near zero.

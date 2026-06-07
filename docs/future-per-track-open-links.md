---
title: Future — Per-track "Open in …" links (deferred)
updated: 2026-06-06
status: idea / not scheduled — context + how-to for a later build
depends_on: docs/spotify-removal-plan.md (the provider switch makes this feasible)
related: docs/wiki/music-providers.md, docs/wiki/pages-and-components.md, docs/wiki/external-apis.md
---

# Future — Per-track "Open in …" links

**Not for the current build.** This captures the line of thinking so a later session
understands *why* per-track links were removed, *why* the Spotify-independence switch makes
them feasible again, and *how* to add them cleanly.

## Background — why per-track was removed
Per-track "Open in Spotify / Apple Music / YouTube Music" was pulled because it didn't work
reliably. Root cause (verified in code):
- The link layer (`lib/music-links.ts`) is **artist-only** (`getArtistLink` /
  `getShareableArtistLink`). There was never a track-level builder.
- Tracks are sourced primarily from **iTunes** (`lib/music-provider/itunes.ts`). A
  `Track.spotifyTrackId` is **`null`** for every iTunes track until JIT-resolved via
  `POST /api/spotify/resolve-track` — which requires a **Spotify API call + the user's
  OAuth token**. For cold / non-Spotify-connected users and during shared-key throttles,
  that resolve fails → dead per-track Spotify links. Same Spotify dependency the
  [[spotify-dependency]] switch removes.

## Why the switch makes this feasible
The Spotify-independence work makes **iTunes the track-of-record**. iTunes Search already
returns, per track, an exact Apple Music URL — we simply don't capture it yet. Combined with
honoring `users.preferred_music_platform` (already a column), per-track links become a clean,
mostly-zero-API feature for everything except *exact* Spotify deep-links.

## How — per platform

| Platform | Approach | Spotify API needed? | Reliability |
|---|---|---|---|
| **Apple Music** | Capture iTunes `trackViewUrl` (exact track page) at fetch time. | No | Exact ✅ |
| **YouTube Music** | `https://music.youtube.com/search?q={artist track}` (same pattern as the artist link). | No | Song is top hit (not exact) |
| **Spotify** | Exact = `spotifyTrackId` via the existing `/api/spotify/resolve-track` (user token), resolved **on click**, low-volume — NOT a ratelimit risk. Zero-API fallback: `https://open.spotify.com/search/{artist track}`. | Exact: yes (on-click, opt-in). Fallback: no | Exact for connected users; search-URL otherwise |
| **Deezer** | Deezer track search returns ids/links — only if Deezer is ever validated/integrated. | No (if reachable) | Unverified |

## Concrete implementation sketch (when scheduled)
1. **Capture the Apple track URL.** In `lib/music-provider/itunes.ts`, add `trackViewUrl`
   (and optionally `collectionId`) to the `ITunesResult` interface and to the mapped
   `Track`. Add `trackUrl?: string | null` to the `Track` type in
   `lib/music-provider/types.ts`. (iTunes already returns `trackViewUrl`; it's just dropped
   today.) This is the single enabling data change.
2. **Add a track-level link builder** `getTrackLink(platform, { track, artistName })` next
   to `getArtistLink` in `lib/music-links.ts`:
   - `apple_music` → `track.trackUrl` (fallback: artist link).
   - `youtube_music` → `music.youtube.com/search?q={artist + track}`.
   - `spotify` → `open.spotify.com/track/{spotifyTrackId}` if known, else
     `open.spotify.com/search/{artist + track}`.
3. **On-click Spotify resolution (optional, connected users only).** Keep using
   `/api/spotify/resolve-track` but call it lazily *when the user clicks* the Spotify
   per-track link (not during generation). On-click + low-volume = safe for the shared key.
   For non-connected users, skip straight to the search-URL fallback.
4. **UI.** Add the per-track link to `components/feed/track-strip.tsx` (the row already has
   the track + artist context), gated on `preferred_music_platform`. The artist-level
   "Open in …" button stays as-is.

## Prerequisites / ordering
- Do this **after** the Spotify-independence switch (`docs/spotify-removal-plan.md`), so the
  track-of-record is settled and the per-platform fallbacks are the norm.
- No schema change required for Apple/YouTube. The Spotify `spotifyTrackId` column already
  exists on the track payload.

## What NOT to do
- Don't resolve Spotify track ids during generation/batch — that reintroduces the
  shared-key ratelimit risk. Per-track Spotify resolution must be **on-click only**.
- Don't rely on MusicBrainz *recording*-level url-rels for Spotify track ids — coverage is
  thin and iTunes→recording matching is fuzzy. The search-URL fallback is the dependable
  zero-API option.

## Effort / confidence
Small (~1–2 days) once the provider switch lands. High confidence for Apple + YouTube;
Spotify exact links remain a connected-user nicety with a reliable non-exact fallback.

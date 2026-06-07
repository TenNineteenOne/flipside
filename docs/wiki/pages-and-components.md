---
title: Pages, Components & Client Data Flow
updated: 2026-06-06
related: [[api-routes]], [[generation-engine]], [[explore-engine]], [[settings-and-discovery]]
---

# Pages, Components & Client Data Flow

The UI. Two route groups (see [[architecture-overview]]): `(app)` (authed, persistent
nav + player) and `(marketing)` (sign-in, onboarding). Every `(app)` page is an async
server component that queries Supabase, then hands data to a `"use client"` shell.

## Screens (`app/(app)` + `app/(marketing)`)

| Screen | Loads | Client shell / notes |
|---|---|---|
| `/sign-in` | — | username-only `signIn("credentials")`, then `/api/onboarding/check` → onboarding or feed |
| `/onboarding` | — | artist search + genre picker + Last.fm/stats.fm usernames + platform; saves via `PATCH /api/settings` + `POST /api/onboarding/seeds`; fire-and-forget first generate |
| `/feed` | `recommendation_cache` (unseen, scored, ≤20), tracks cache, signal counts; empty → `RecommendationsLoader` + `ExplorePrewarm` | `FeedClient`: `interleave()`, drop no-preview cards, `useFeedFill` poll-append, low-queue auto-generate |
| `/explore` | `buildExploreRails({hydrate, regenerate:false})` (never blocks); challenge streamed via React 19 `use()` | `ExploreClient`: poll-swap after shuffle/settings, tab pills, adventurous toggle reorders rails |
| `/history` | seen recs + feedback/saves, derived `signal` | `HistoryClient`: filter tabs, time grouping, undo via feedback/dismiss endpoints |
| `/saved` | `saves` enriched from `recommendation_cache` | `SavedClient`: grid, optimistic unsave, open-in-platform + share |
| `/stats` | 6 parallel count queries + taste profile | `StatsClient`: stat cards, top genres, SVG popularity scatter |
| `/settings` | decrypted usernames, source counts, seeds, example artists | `SettingsForm` → 6 panels (Profile, Account, Platform, ConnectedSources, Seeds, Obscurity) |

## Shared components

- **`ArtistCard`** (`components/feed/artist-card.tsx`) — the primary card: 340px hero image
  (tinted by `artist_color`), `TrackStrip`, reason pill, actions. States via `dismissSignal`
  (collapse on down/skip, green outline on up). Hooks: `useAudio`, `useArtistTracks`,
  `useArtistColor`. "Open in {platform}" + Share + Bookmark + feedback strip.
- **`TrackStrip`** — 1–3 playable tracks (expandable); play button → `onPlay`. No network.
- **`MiniPlayer`** (`components/player/`) — persistent floating pill from `useAudio`
  context; play/pause/stop + progress.
- **`ExploreArtistRow`** — adapts a `RailArtist` into `ArtistCard`. (`Rail`, a compact
  horizontal-scroll layout, exists but is legacy/secondary in the current Explore.)
- **`ArtistSearch`** (`components/onboarding/`) — debounced (350ms) `GET /api/onboarding/
  search`; shows a "degraded" notice on Spotify rate-limit fallback.
- **`PlatformIcon`** — inline SVG per `spotify`/`apple_music`/`youtube_music`.

## Client hooks (`lib/hooks/`)

| Hook | State | API |
|---|---|---|
| `useFeedFill` | seen ids, counts | polls `GET /api/recommendations` (2.5s) → append playable; stops at target / 3 idle / 60s |
| `useArtistTracks` | tracks | `GET /api/artists/:id/tracks?name=` (only if no baked tracks) |
| `useArtistColor` | — | `useMemo`: sanitized hex or deterministic name-hash fallback |
| `useArtistFeedback` | `Map<id,signal>` | POST/DELETE `/api/feedback`; `skip` is local-only; optimistic + rollback + per-artist serializer |
| `useArtistSaves` | `Set<id>` | POST/DELETE `/api/saves`; optimistic + rollback + serializer |
| `useAdventurousMode` | bool | `localStorage` + cross-tab sync + `PATCH /api/settings` |

## Playback & "Open in platform"

Single `HTMLAudioElement` in `AudioProvider`; only `previewUrl`-bearing tracks play. The
player is **source-agnostic** (`itunes`/`spotify`/`deezer`). "Open in {platform}" uses
`lib/music-links.getArtistLink`:

| Platform | URL |
|---|---|
| spotify | `https://open.spotify.com/artist/{id}` (direct, zero-API) |
| apple_music | `/api/open/apple_music/{id}?name=` (iTunes resolver + cache) |
| youtube_music | `https://music.youtube.com/search?q={name}` (no API) |

Default platform is `spotify`. See [[spotify-dependency]] for how the Spotify open-link
survives without the API. Extending platforms touches `music-links.ts`,
`platform-icon.tsx`, and the DB CHECK constraint.

## Surprises
- `TrackStrip.artistId` prop is documented for a save-to-playlist feature that doesn't exist.
- Stats is the only screen with no open-in-platform link.
- History's "dismissed" undo (`/api/dismiss`) clears `skip_at`+`seen_at` (re-eligible);
  feedback undo leaves `seen_at` set.

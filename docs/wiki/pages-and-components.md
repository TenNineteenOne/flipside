---
title: Pages, Components & Client Data Flow
updated: 2026-10-24
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
| `/onboarding` | — | artist search + genre picker + Last.fm/stats.fm usernames + platform; saves via `patchSettings` (`PATCH /api/settings`) + `POST /api/onboarding/seeds` (a different route from Settings' `/api/settings/seed-artists`); fire-and-forget first generate (`postGenerate`) |
| `/feed` | `recommendation_cache` (unseen, scored, ≤20), tracks cache, signal counts; empty → `RecommendationsLoader` + `ExplorePrewarm` | `FeedClient`: renders `CardArtist[]` from `loadFeedCards` (`lib/cards/feed-cards.ts`: tracks-cache fallback, colour lift, drop no-preview cards, `interleave()`); `useFeedFill` poll-append (same assembler via `GET /api/recommendations`), low-queue auto-generate |
| `/explore` | `buildExploreRails({hydrate, regenerate:false})` (never blocks); challenge streamed via React 19 `use()` | `ExploreClient`: JSX over `useRailSession` (`lib/client/rail-session.ts`: rails, active rail, adventurous ordering, shuffle/apply, poll-swap after shuffle/settings) |
| `/history` | seen recs + feedback/saves, derived `signal` | `HistoryClient`: filter tabs, time grouping; signal changes + undo/unblock via `useArtistFeedback` (`setSignal` / `removeSignal` / `dismiss`) |
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
- **`CardArtist`** (`lib/cards/card-artist.ts`) — the one card view model (`ArtistWithTracks`
  + raw `artistColor` + `why {sourceArtists, genres}`). Assembled server-side by
  `lib/cards/feed-cards.ts` (Feed) and `lib/cards/explore-rail-payloads.ts` (Explore);
  `ArtistCard` takes it directly. Display colour always goes through
  `resolveArtistColor` (`lib/color-utils.ts`: sanitize; `#8b5cf6` sentinel/null → name hash).
- **`ExploreArtistRow`** — motion wrapper binding a `CardArtist` to `ArtistCard`.
- **`ArtistSearch`** (`components/onboarding/`) — debounced (350ms) `GET /api/onboarding/
  search`; shows a "degraded" notice on Spotify rate-limit fallback.
- **`PlatformIcon`** — inline SVG per `spotify`/`apple_music`/`youtube_music`.

## Client hooks (`lib/hooks/`)

| Hook | State | API |
|---|---|---|
| `useFeedFill` | seen ids, counts | polls `GET /api/recommendations` (2.5s, assembled `CardArtist[]`) → append playable; stops at target / 3 idle / 60s (after one final poll) |
| `useArtistTracks` | tracks | `GET /api/artists/:id/tracks?name=` (only if no baked tracks) |
| `useArtistColor` | — | `useMemo`: sanitized hex or deterministic name-hash fallback |
| `useArtistFeedback` | `Map<id,signal>` | POST/DELETE `/api/feedback`, DELETE `/api/dismiss`; Explore `skip` is local-only. Controller `lib/client/artist-signals.ts`: optimistic at tap time, per-artist serialized, falls back to last confirmed value when the last queued call fails |
| `useArtistSaves` | `Set<id>` | POST/DELETE `/api/saves`; same artist-signal controller |
| `useAdventurousMode` | bool | `localStorage` + cross-tab sync + `patchSettings` |
| `useFeedGeneration` | generating | the only `POST /api/recommendations/generate` caller with a guard (`lib/client/feed-generation.ts`): `requestMore` (feed top-up / Load more), `rebuild` (Settings: feed + Explore; Explore 429 = already refreshing = success). Splash/loader/onboarding use its `postGenerate` + `classifyGenerate` |
| `useRailSession` | rail session | Explore controller (see above) |

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
- Stats is the only screen with no open-in-platform link.
- History's "dismissed" undo (`/api/dismiss`) clears `skip_at`+`seen_at` (re-eligible);
  feedback undo leaves `seen_at` set.

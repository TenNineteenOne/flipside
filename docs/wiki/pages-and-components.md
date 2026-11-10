---
title: Pages, Components & Client Data Flow
updated: 2026-11-09
related: [[api-routes]], [[generation-engine]], [[explore-engine]], [[settings-and-discovery]]
---

# Pages, Components & Client Data Flow

The UI. Two route groups (see [[architecture-overview]]): `(app)` (authed, persistent
nav + player) and `(marketing)` (sign-in, onboarding). Every `(app)` page is an async
server component that queries Supabase, then hands data to a `"use client"` shell.

## Screens (`app/(app)` + `app/(marketing)`)

| Screen | Loads | Client shell / notes |
|---|---|---|
| `/` (landing) | nothing: static, prerendered; never reads session, cookies or headers | `app/page.tsx` + `app/landing.css` (scoped under `.ev-landing`). Hero is `HeroStack` (`components/landing/hero-stack.tsx`) inside its own `AudioProvider`: six sample artists from `data/landing-sample.json` (regenerate with `npm run build:landing-sample`; `validateLandingSample` in `lib/landing/sample.ts` keeps every URL on the CSP's iTunes hosts). Signed-in visitors never see it: the proxy redirects `/` to `/feed` |
| `/sign-in` | — | username-only `signIn("credentials")` (Existing / New mode, `?mode=new` from the landing CTA), then `/api/onboarding/check` → onboarding or feed (`router.replace`); signed-in users are bounced to `/feed` by the proxy |
| `/onboarding` | — | artist search + genre picker + Last.fm/stats.fm usernames + platform; saves via `patchSettings` (`PATCH /api/settings`) + `POST /api/onboarding/seeds` (a different route from Settings' `/api/settings/seed-artists`); fire-and-forget first generate (`postGenerate`). Genres cap at 50; "Get started" is disabled while 1–2 artists are picked (the seeds route needs ≥3). `/feed` redirects here until onboarding is done |
| `/feed` | `recommendation_cache` (unseen, scored, ≤20), tracks cache, signal counts; empty → `RecommendationsLoader` + `ExplorePrewarm` | `FeedClient`: ≥900px renders `FeedDesktop` (queue + focus pane), below 900px the `ArtistCard` list (one tree, picked by a `matchMedia` `useSyncExternalStore`, server = list); both read `useFeedTriage`. Renders `CardArtist[]` from `loadFeedCards` (`lib/cards/feed-cards.ts`: tracks-cache fallback, colour lift, drop no-preview cards, `interleave()`); `useFeedFill` poll-append (same assembler via `GET /api/recommendations`), low-queue auto-generate |
| `/explore` | `buildExploreRails({hydrate, regenerate:false})` (never blocks); challenge streamed via React 19 `use()` | `ExploreClient`: JSX over `useRailSession` (`lib/client/rail-session.ts`: rails, active rail, adventurous ordering, shuffle/apply, poll-swap after shuffle/settings; a regen POST 429 means a build is already running → poll; Shuffle/Apply/cold start write `explore-regen-at` so a later visit resumes the poll; a thrown final GET is retried once after 1.5s) |
| `/history` | seen recs + feedback/saves, derived `signal` | `HistoryClient`: filter tabs, time grouping; signal changes + undo/unblock via `useArtistFeedback` (`setSignal` / `removeSignal` / `dismiss`) |
| `/saved` | `saves` enriched from `recommendation_cache` | `SavedClient`: grid, optimistic unsave, open-in-platform + share |
| `/stats` | 6 parallel count queries + taste profile | `StatsClient`: stat cards, top genres, SVG popularity scatter |
| `/settings` | decrypted usernames, source counts, seeds, example artists | `SettingsForm` → 6 panels (Profile, Account, Platform, ConnectedSources, Seeds, Obscurity) |

## Shared components

- **`AppShell`** (`components/shell/app-shell.tsx`, styles in `shell.css`) — signed-in chrome,
  rendered by `app/(app)/layout.tsx`. ≥900px: fixed left rail (Feed, Explore, History, Saved,
  Stats, Settings; 232px, icons-only 64px at 900–1099px). Below 900px: top bar (wordmark +
  identicon avatar opening a native popover with Settings and Sign out via
  `next-auth/react` `signOut`) and a five-item bottom tab bar. Which shows is CSS only.
  `aria-current="page"` when the path equals a link or starts with it plus `/`. Adventurous
  mode (`useAdventurousMode`) draws a 2px gradient on the rail edge / under the top bar.
  Pages hook in via `components/shell/shell-context.tsx`: `useShellBadge(href, n)` (nav count),
  `useShellShortcuts(fn)` (shows the rail's Shortcuts button), `<ShellSlot name="top"|"rail">`
  (portal into the top bar / under the rail nav). Page content keeps its 520px `.app-col`,
  unless its root has `.shell-fill` (desktop feed): then `.shell-main:has(.shell-fill)` drops the
  padding and column and is exactly viewport-high, so the page body never scrolls.

- **Dev preview** (`app/dev-preview/*`, `lib/dev-preview/fixtures.ts`) — development-only
  harness (404 in production) rendering the real shell and components with fixture artists and
  a stubbed same-origin `/api/*` fetch. Production code never imports it.
- **`ArtistCard`** (`components/feed/artist-card.tsx`) — the primary card: 340px hero image
  (tinted by `artist_color`), `TrackStrip`, reason pill, actions. States via `dismissSignal`
  (collapse on down/skip, green outline on up). Hooks: `useAudio`, `useArtistTracks`,
  `useArtistColor`. "Open in {platform}" + Share + Bookmark + feedback strip.
- **`useFeedTriage`** (`lib/hooks/use-feed-triage.ts`) — the feed's one triage object: selection
  (initially `firstUndecided`), verdicts read only from `useArtistFeedback`'s `signals`, saves,
  playback per artist, and `judge(id, signal, { toggle, advance })`, which runs the pure
  `decide()` (`lib/feed/decision.ts`) and executes its plan (send, select, play/pause), then
  shows one sonner toast (stable id, 5s) with an Undo action; `undoLast()` runs the plan's undo
  (`setSignal` thumbs_up again / `removeSignal` / `dismiss`) and reselects, only while that toast
  is up. Also `save`, `share` (share sheet, else clipboard), `artistLink`, `playTrack`, and
  `tuning` (`lib/feed/tuning.ts`). Tracks fetched on demand by the focus pane are registered
  with `addTracks`.
- **`FeedDesktop`** (`components/feed/feed-desktop.tsx`, styles `feed.css` under `.ev-feed`) —
  queue column ("N of M left", strip, rows) and focus pane (artwork via `artworkFor` or a
  letter panel, why, popularity, Play preview, the three triage buttons, Save / Open in
  {platform} / Share, up to three preview tracks, docked player), plus the rail "Tuning" block
  via `<ShellSlot name="rail">`. No decision logic. `FeedClient` sets the Saved badge
  (`useShellBadge`) to saves made since the feed opened.
- **`MiniPlayer`** (`components/player/mini-player.tsx`) — floating pill by default;
  `<MiniPlayer docked />` is the in-page player at the bottom of the desktop focus pane. While a
  docked one is mounted (a module-level count read with `useSyncExternalStore`) the floating pill
  renders nothing, so no route or width checks are needed.
- **`TrackStrip`** — 1–3 playable tracks (expandable); play button → `onPlay`. No network.
- **`MiniPlayer`** (`components/player/`) — persistent floating pill from `useAudio`
  context; play/pause/stop + progress.
- **`CardArtist`** (`lib/cards/card-artist.ts`) — the one card view model (`ArtistWithTracks`
  + raw `artistColor` + `why {sourceArtists, genres}`). Assembled server-side by
  `lib/cards/feed-cards.ts` (Feed) and `lib/cards/explore-rail-payloads.ts` (Explore);
  `ArtistCard` takes it directly. Display colour always goes through
  `resolveArtistColor` (`lib/color-utils.ts`: sanitize; `#8b5cf6` sentinel/null → name hash).
- **`ExploreArtistRow`** — motion wrapper binding a `CardArtist` to `ArtistCard`.
- **`ArtistSearch`** (`components/onboarding/`) — debounced (350ms), 2-char minimum, `GET /api/onboarding/
  search`; shows a "degraded" notice on Spotify rate-limit fallback.
- **`PlatformIcon`** — inline SVG per `spotify`/`apple_music`/`youtube_music`.

## Client hooks (`lib/hooks/`)

| Hook | State | API |
|---|---|---|
| `useFeedFill` | seen ids, counts | polls `GET /api/recommendations` (2.5s, assembled `CardArtist[]`) → append playable; stops at target / 3 idle / 60s (after one final poll, retried once after 1.5s if the fetch throws) |
| `useArtistTracks` | tracks | `GET /api/artists/:id/tracks?name=` (only if no baked tracks) |
| `useArtistColor` | — | `useMemo`: sanitized hex or deterministic name-hash fallback |
| `useArtistFeedback` | `Map<id,signal>` | POST/DELETE `/api/feedback`, DELETE `/api/dismiss`; Explore `skip` is local-only. Controller `lib/client/artist-signals.ts`: optimistic at tap time, `railKey` captured at tap time, per-artist serialized, falls back to last confirmed value when the last queued call fails |
| `useArtistSaves` | `Set<id>` | POST/DELETE `/api/saves`; same artist-signal controller |
| `useAdventurousMode` | bool | `localStorage` + cross-tab sync + `patchSettings` |
| `useFeedGeneration` | generating | the only `POST /api/recommendations/generate` caller with a guard (`lib/client/feed-generation.ts`): `requestMore` (feed top-up / Load more), `rebuild` (Settings: feed + Explore; Explore 429 = already refreshing = success). `release()` (unmount) reports generating=false and silences the abandoned run; the feed skips `router.refresh()` after unmount. Loader/onboarding use its `postGenerate` + `classifyGenerate` |
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

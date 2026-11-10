---
title: Pages, Components & Client Data Flow
updated: 2026-11-10
related: [[api-routes]], [[generation-engine]], [[explore-engine]], [[settings-and-discovery]]
---

# Pages, Components & Client Data Flow

The UI. Two route groups (see [[architecture-overview]]): `(app)` (authed, inside the
`AppShell` with the audio provider and player) and `(marketing)` (sign-in, onboarding), plus
the static landing page at `/` and the development-only `/dev-preview` harness. Every `(app)`
page is an async server component that queries Supabase, then hands data to a `"use client"`
shell.

## Look (the "Evolved" redesign, PRD #182)

Tokens live in `app/globals.css` `:root`: `--bg`, `--rail`, `--panel`, `--raise`, `--line`,
`--line-strong`, `--fg` / `--fg-2` / `--fg-3`, `--violet` (the one accent), `--violet-ink`
(violet text, focus rings), `--violet-wash` (chips), `--violet-fill` (the background behind
white text on violet: `--violet` itself is 4.2:1 with white, this is 4.7:1), `--ease`. The old
names (`--bg-base`, `--text-primary`, `--accent`, …) and the shadcn mappings are re-pointed at
them, so untouched pages follow. Two fonts (`next/font`): Familjen Grotesk for all text, Martian
Mono for key hints, durations and counts. Only Familjen Grotesk's latin file is preloaded; latin-ext
and Martian Mono load by `unicode-range` when a page uses them (metric-adjusted fallbacks, `swap`). Each artist's colour is `--a` on its card or row, with
`--a-dark` / `--a-light` derived in CSS. No glow, blur, grain or blend layers. A base
`:focus-visible` rule draws a 2px `--violet-ink` ring on everything focusable; components may
refine it. The old per-page radial "ambient" backgrounds (Explore, Saved, Settings) are gone; those
pages sit on the plain `--bg`.

Browser floor: container query units need Safari 16.0 and `:has()` 15.4, so the effective minimum is
**Safari 16.0**. `color-mix()` needs 16.2: `@supports not (color: color-mix(…))` blocks in
`globals.css`, `feed.css` and `landing.css` give 16.0–16.1 flat equivalents (`--violet-fill`
`#8054e3`, `--violet-wash` as rgba, `--a-dark` / `--a-light` = `--a`, mixed backgrounds → tokens).
Breakpoints use range syntax (`width < 900px` / `width >= 900px`) so fractional widths (zoom, OS
scaling) always match exactly one side. The layout rule (feed and shell): **desktop** (rail, feed
panes) at width ≥ 900px and height ≥ 540px; **tablet** feed at 640–899px wide and ≥ 680px tall;
otherwise the phone **Snap** feed with the top bar and tab bar (this includes phones in landscape
900px and wider, e.g. 932x430, and short desktop windows). Under `forced-colors: active` the
progress strip (current = `Highlight`, liked = `CanvasText`, passed = `GrayText`), selected rows,
popularity meter and cold-start bar get system colours, and the background-only controls (Snap
triage buttons, track chips, Play preview, the landing's primary buttons) a 1px `ButtonText` border.

## Screens (`app/(app)` + `app/(marketing)`)

| Screen | Loads | Client shell / notes |
|---|---|---|
| `/` (landing) | nothing: static, prerendered; never reads session, cookies or headers | `app/page.tsx` + `app/landing.css` (scoped under `.ev-landing`). Hero is `HeroStack` (`components/landing/hero-stack.tsx`) inside its own `AudioProvider`: six sample artists from `data/landing-sample.json` (the card throw and settle are CSS keyframes in `landing.css`, no framer-motion on this page; Less throws left, More right; a verdict given from the keyboard moves focus to the same button on the next card, a pointer verdict never moves focus) (regenerate with `npm run build:landing-sample`; `validateLandingSample` in `lib/landing/sample.ts` keeps every URL on the CSP's iTunes hosts). Signed-in visitors never see it: the proxy redirects `/` to `/feed` |
| `/sign-in` | — | username-only `signIn("credentials")` (Existing / New mode, `?mode=new` from the landing CTA), then `/api/onboarding/check` → onboarding or feed (`router.replace`); signed-in users are bounced to `/feed` by the proxy |
| `/onboarding` | — | artist search + genre picker + Last.fm/stats.fm usernames + platform; saves via `patchSettings` (`PATCH /api/settings`) + `POST /api/onboarding/seeds` (a different route from Settings' `/api/settings/seed-artists`); fire-and-forget first generate (`postGenerate`). Genres cap at 50; "Get started" is disabled while 1–2 artists are picked (the seeds route needs ≥3). `/feed` redirects here until onboarding is done |
| `/feed` | `recommendation_cache` (unseen, scored, ≤20), tracks cache, signal counts; empty → `RecommendationsLoader` + `ExplorePrewarm`; `loading.tsx` (re-exporting `FeedSkeleton`, `components/feed/feed-skeleton.tsx`) is a CSS-only skeleton per layout (desktop panes, tablet card + Up next, one Snap page + triage bar, reserving the top bar's count/strip row), so nothing shifts when the feed arrives | `FeedClient`: the desktop layout renders `FeedDesktop` (queue + focus pane), the tablet layout `FeedTablet`, otherwise `FeedSnap` (layout rule under Look; one tree, picked by a `matchMedia` `useSyncExternalStore`; each layout is a `next/dynamic` chunk with `FeedSkeleton` as its fallback, so a device downloads only its layout. The server and hydration render the layout guessed from the request (`guessFeedLayout`, `lib/feed/layout-guess.ts`: `Sec-CH-UA-Mobile`, else the user agent; Snap for phones, desktop otherwise) passed as `initialLayout` and returned as the server snapshot, so its chunk is preloaded; `feed.css` hides a server-rendered Snap or desktop tree wherever it is not the viewport's layout, and during the server render and hydration `FeedClient` renders `FeedSkeleton` beside it (`.ev-guess-skel`, `data-guess`) whose tree for the guessed layout never shows, so a wrong guess (every tablet in portrait, some Android tablets) shows the viewport's skeleton, never a blank area; after hydration the right layout's `loading` skeleton takes its place in the same frame. Each layout reports itself mounted (`onShown`) and `FeedShortcuts` ignores keys until the layout on screen is mounted. After the first layout has mounted, the load event and an idle callback, the three `dynamic()` loaders are run (kept by reference: a plain `import()` compiles to a separate copy of each chunk), so a later layout switch needs no network; a loader whose import fails (offline, or the chunk gone after a deploy) retries every 4s while the skeleton stays instead of reaching the error boundary. Art, `artistVar`, `EndState` and `LoadMore` live in `feed-parts.tsx`, shared by the three layouts); all read `useFeedTriage`, so resizing keeps selection, verdicts, saves and playback. Renders `CardArtist[]` from `loadFeedCards` (`lib/cards/feed-cards.ts`: tracks-cache fallback, colour lift, drop no-preview cards, `interleave()`); `useFeedFill` poll-append (same assembler via `GET /api/recommendations`), low-queue auto-generate |
| `/explore` | `buildExploreRails({hydrate, regenerate:false})` (never blocks); challenge streamed via React 19 `use()` | Rails of `ArtistCard`s (the only remaining user of that card). `ExploreClient`: JSX over `useRailSession` (`lib/client/rail-session.ts`: rails, active rail, adventurous ordering, shuffle/apply, poll-swap after shuffle/settings; a regen POST 429 means a build is already running → poll; Shuffle/Apply/cold start write `explore-regen-at` so a later visit resumes the poll; a thrown final GET is retried once after 1.5s) |
| `/history` | seen recs + feedback/saves, derived `signal` | `HistoryClient`: filter tabs, time grouping; signal changes + undo/unblock via `useArtistFeedback` (`setSignal` / `removeSignal` / `dismiss`) |
| `/saved` | `saves` enriched from `recommendation_cache` | `SavedClient`: grid, optimistic unsave, open-in-platform + share |
| `/stats` | 6 parallel count queries + taste profile | `StatsClient`: stat cards, top genres, SVG popularity scatter |
| `/settings` | decrypted usernames, source counts, seeds, example artists | `SettingsForm` → 6 panels (Profile, Account, Platform, ConnectedSources, Seeds, Obscurity) |

## Shared components

- **`AppShell`** (`components/shell/app-shell.tsx`, styles in `shell.css`) — signed-in chrome,
  rendered by `app/(app)/layout.tsx`. Desktop layout (≥900px wide, ≥540px tall): fixed left rail (Feed, Explore, History, Saved,
  Stats, Settings; 232px, icons-only 64px at 900–1099px). Otherwise: top bar (wordmark +
  identicon avatar (`IdenticonAvatar`: a seeded inline SVG from `lib/identicon.ts`, in the style of the DiceBear "shapes" avatar it replaced) menu button with Settings and Sign out via `next-auth/react` `signOut`; a
  state-driven menu, not the Popover API, so Safari before 17 works: `aria-haspopup="menu"` /
  `aria-expanded`, rendered only while open, focus moves in on open, closes on Escape (focus back
  to the button), outside pointer down, Tab out, item activation and route change, arrow keys move
  between items) and a five-item bottom tab bar. Which shows is CSS only.
  `aria-current="page"` when the path equals a link or starts with it plus `/`. Adventurous
  mode (`useAdventurousMode`) draws a 2px gradient on the rail edge / under the top bar.
  Pages hook in via `components/shell/shell-context.tsx`: `useShellBadge(href, n)` (nav count),
  `useShellShortcuts(fn)` (shows the rail's Shortcuts button), `<ShellSlot name="top"|"topSub"|"rail">` (topSub: an optional full-width second row under the phone top bar, hidden when empty)
  (portal into the top bar / under the rail nav). The rail shows at ≥900px wide and ≥540px tall,
  the top bar and tab bar otherwise (shell.css; the same desktop condition as the feed); the avatar
  menu closes itself when the rail appears (`matchMedia` change), so it never swallows a later
  Escape or reappears on narrowing. Page content keeps its 520px `.app-col`,
  unless its root has `.shell-fill` (desktop feed): then `.shell-main:has(.shell-fill)` drops the
  padding and column and is exactly viewport-high, so the page body never scrolls.

- **Dev preview** (`app/dev-preview/*`, `lib/dev-preview/fixtures.ts`) — development-only
  harness (404 in production) rendering the real shell and components with fixture artists and
  a stubbed same-origin `/api/*` fetch. Production code never imports it. Its layout passes
  `AppShell` `pathPrefix="/dev-preview"` so `/dev-preview/feed` marks Feed as current.
  The fixtures' 2nd artist has the 1st's first track as its third (a shared collaboration track id).
  `/dev-preview/feed?start=N` starts with N artists and the stub serves the rest in batches of 6
  per generate (exercises appends and Load more); `/dev-preview/feed-empty` and
  `/dev-preview/feed-loading` show the empty-feed loader and the loading skeleton;
  `/dev-preview/explore-card` renders Explore's `ExploreArtistRow` / `ArtistCard` in every
  state (expanded, liked + saved, no image, no tracks, passed, dismissed; buttons toggle
  locally); `/dev-preview/shell` shows the shell around filler. Its route files are
  `page.dev.tsx` / `layout.dev.tsx`, and `next.config.ts` adds `dev.tsx` to `pageExtensions`
  only outside production, so `next build` never compiles the harness (no route, no fixture
  data in any chunk); the layout's `notFound()` in production is a second guard. `tsconfig.json`
  excludes `.next/dev` because the dev route types (which include the harness) would otherwise
  clash with a production build's route types in `tsc` and in `next build`'s type check.
- **`ArtistCard`** (`components/feed/artist-card.tsx`) — Explore's card (the feed no longer
  uses it): `--panel` surface, `--line` border (violet when liked), 16px radius, 340px hero
  image with a plain artist-colour gradient tint and a dark scrim, name + "genre · popularity",
  `TrackStrip`, the reason as a `--fg-2` line, then "Open in {platform}" + Share (copy link),
  Bookmark (`aria-pressed`), and Less like this / Dismiss / More like this in the feed's triage
  look (icons drop out below a 360px container). States via `dismissSignal`: down/skip collapse
  to a 56px "Passed" / "Dismissed" bar, up keeps the card with a solid violet "Liked". Hooks:
  `useAudio`, `useArtistTracks`, `useArtistColor`.
- **`ColdStartBanner`** (`components/feed/cold-start-banner.tsx`, styles `.ev-cold*` in
  `feed.css`) — "Flipside signal · N of 5" with "Keep exploring — recs get smarter." and a thin
  violet progress bar until the listener has 5 signals. A `--panel` box at the top of the
  desktop queue; with `onDismiss`, one dismissible line under the top bar (phone and tablet).
- **`useFeedTriage`** (`lib/hooks/use-feed-triage.ts`) — the feed's one triage object: selection
  (initially `firstUndecided`, then `reconcileSelection`: kept across appends, and the first
  newly arrived undecided artist once the queue had run out), verdicts read only from `useArtistFeedback`'s `signals`, saves,
  playback per artist, and `judge(id, signal, { toggle, advance })`, which runs the pure
  `decide()` (`lib/feed/decision.ts`) and executes its plan (send, select, play/pause), then
  shows one sonner toast (5s, a fresh id each time, the previous one dismissed) with an Undo
  action. The plan's undo records the verdict the artist had before (undecided, thumbs_up,
  thumbs_down or skip); `undoLast()` puts it back with `useArtistFeedback`'s `restore`
  (optimistic, queued behind any in-flight call, so a later decision still wins) and
  reselects, only while that toast is up. The toast and pending undo are dropped when the feed
  unmounts; when a decision's request fails (verdict rolled back, error toast from
  `useArtistFeedback`) and its toast is still the current one, that toast and its undo go too. An
  advancing `judge` on a different artist within 350ms of the previous decision that moved the
  selection is ignored (`isDoubleActivation` / `activationStamp`, `lib/feed/double-activation.ts`:
  a double click must not decide an unseen artist; a second decision on the same artist, e.g.
  un-like, still applies, and an un-like, which leaves the selection in place, starts no window).
  On viewports under 480px tall (phones in landscape) the toast is placed top-right under the top
  bar and strip (feed.css), elsewhere bottom-left.
  `nowPlayingArtist` is the artist the hook started the loaded track for (`nowPlayingArtistId`,
  `lib/feed/now-playing.ts`; collaborations share track ids), else the first artist owning it.
  `isCurrentTrack(artist, track)` (pure `isCurrentTrack` in the same file) is true only on that
  artist's card, so the Snap progress ring and current chip and the focus pane's current track row
  show a shared track on one artist only.
  Also `save`, `share` (share sheet, else clipboard), `artistLink`, `playTrack` (a track index the
  artist lacks does nothing), and `tuning` (`lib/feed/tuning.ts`, genres deduped
  case-insensitively, liked wins over passed). Tracks fetched on demand by the focus pane are
  registered with `addTracks`.
- **`FeedDesktop`** (`components/feed/feed-desktop.tsx`, styles `feed.css` under `.ev-feed`) —
  queue column ("N of M left", strip, rows; a passed or dismissed row fades and slides out via
  `useLeaving`, `lib/hooks/use-leaving.ts`, and a CSS keyframe) and focus pane (artwork via `artworkFor` or a
  letter panel, why, popularity, Play preview, the three triage buttons, Save / Open in
  {platform} / Share, up to three preview tracks, docked player; the end-of-queue state with
  counts and "Load more artists" when nothing is selected; `LoadMore` is `aria-disabled` with clicks
  ignored while generating, never `disabled`, so keyboard focus stays on it), the cold-start banner at the top of
  the queue, and the rail "Tuning" block
  via `<ShellSlot name="rail">`. No decision logic. `FeedClient` sets the Saved badge
  (`useShellBadge`) to saves made since the feed opened. `Art` (`feed-parts.tsx`) fetches Apple (`*.mzstatic.com`)
  artwork at three times its display size up to 64px (sharp thumbnails on 3x phones) and twice above
  (`artworkAt`, `lib/feed/artwork.ts`; never above the stored size; Spotify `i.scdn.co` URLs pass
  through), and the selected artist's art (focus pane, first Snap card) with
  `fetchPriority="high"`; the other thumbnails (landing queue, mini players, track strip,
  history, onboarding search) use the same helper.
- **`FeedSnap`** (`components/feed/feed-snap.tsx`) — phones below 640px, and every viewport too
  short for the tablet or desktop layout (phones in landscape at any width, browser zoom): a fixed column between
  the shell top bar and tab bar (the page body does not scroll): the cold-start hint as one
  dismissible line (`ColdStartBanner` with `onDismiss`; same threshold and copy), a vertical
  scroller with mandatory snapping, one full-height page per loaded artist (decided ones included,
  feed order) plus a final end page (`EndState`, "Load more artists") once nothing is undecided, a
  small player bar (the docked `MiniPlayer`) only while the loaded track is not the artist on
  screen, and the three-button triage bar (kept in layout but hidden and `inert` with no artist
  selected, so pages never resize). "N of M left" goes in `<ShellSlot name="top">`, the segment
  strip in `<ShellSlot name="topSub">`. An `IntersectionObserver` (scroller root, threshold 0.6)
  calls the hook's `becomeCurrent(id | null)` (null = end page), which also hands playback over
  (`shouldHandOver`, `lib/feed/hand-over.ts`: only while another artist's track is playing); any
  other selection change (decision advance, J/K, undo, an append after the end) scrolls that page
  into view, ignoring observer callbacks for other pages until `scrollend` (timeout fallback).
  When that scroll ends, and whenever the scroller changes size (`ResizeObserver`: the player bar
  showing or leaving during a hand-over), the selected page is put exactly in view instantly, as
  browsers do not re-snap after a size change.
  Each page renders **`SnapCard`** (`components/feed/snap-card.tsx`, shared with the tablet
  layout): artwork sized `min(100cqw - 52px, 100cqh - 236px, 460px)` on an artist-colour mat,
  64px play button with a 30-second ring, name, genres + save / open / share, why, up to three
  track chips; artists without tracks fetch them (`useArtistTracks`) only while selected.
  Short pages (container queries on the page, `ev-page`): the artwork shrinks to 76px, then the
  chips go (below 312px), then the why line (below 262px), so play, name and the icon row stay
  whole from 220px up; wide short pages (landscape, ≥560px wide and <356px tall) put the artwork
  beside the text, down to ~90px (these sideways rules select Snap pages only; the tablet stage,
  also an `ev-page` container, keeps the card upright and gets the narrow pages' shrink steps at any
  width). Under 480px of viewport height the cold-start line is hidden.
  Programmatic scrolls measure offsets from the scroller (`el.offsetTop - root.offsetTop`).
  Swipe (framer-motion `drag="x"`, direction lock, `touch-action: pan-y pinch-zoom` set in CSS over
  framer's inline `pan-y`; a `pointercancel` / `touchcancel` never commits): past 96px, or a flick
  past 40px over 500px/s, unless released with a flick back over 500px/s (`swipeDirection`,
  `lib/feed/swipe.ts`), right = `thumbs_up`, left =
  `thumbs_down` via `judge(…, { toggle: false, advance: true })`; the card springs back to rest in
  place (`dragSnapToOrigin`) while the scroller moves on, and ignores drags until at rest. Violet /
  dark labels fade in from 24 to 96px. Decided cards show a "Liked" badge, or dimmed artwork with a
  "Less like this" / "Dismissed" badge, on the artwork; sideways cards show it beside the name instead
  (a second copy in `.ev-m-title`), as their artwork can be too small to hold it beside the play button. Reduced motion: no rotation or spring, instant scroll.
  The floating pill is hidden while the feed is mounted (`useSuppressFloatingPlayer`); the undo
  toast is lifted above the triage bar (and the player bar when shown).
- **`FeedTablet`** (`components/feed/feed-tablet.tsx`) — 640–899px and at least 680px tall: the selected artist's
  `SnapCard` (swipeable, entrance scale-up, next undecided artist as a ghost behind it) in a size
  container, the triage bar under it (≤528px), and a 280px "Up next" list of every loaded artist
  in feed order (thumbnail, name, first genre; violet heart badge when liked, dimmed with an X when
  passed/dismissed; `aria-current` on the selected row; tap selects; scrolls on its own and keeps
  the selected row centred; "Load more artists" is always its last item, as it is at the end of
  the desktop queue column). Shares `TopBarProgress`, `ColdLine`, `PlayerBar` and `TriageBar`
  with `FeedSnap`; the end state takes the card's place when nothing is left.
- **`FeedShortcuts`** (`components/feed/feed-shortcuts.tsx`) — mounted by `FeedClient` at every
  width: one window `keydown` listener mapped by the pure `feedAction` (`lib/feed/feed-keymap.ts`)
  onto the triage hook, and the "?" sheet (native `<dialog>`, also opened by the rail's Shortcuts
  item via `useShellShortcuts`). Held-key auto-repeat only repeats J/K (and arrows); on
  non-Latin layouts an unbound key falls back to its physical `code` (`KeyX`, `Digit1`…; `?`
  stays key-based). J/K from a decided selection go to the nearest visible artist in feed
  order (`step`). Keys whose target is inside an open menu, dialog or popup (`[role="menu"]`,
  `[role="dialog"]`, `dialog[open]`, other than the shortcut sheet) or that are already
  `defaultPrevented` are ignored (`targetInPopup` / `defaultPrevented` in `feedAction`), as are
  all keys while the layout on screen is not mounted yet (`enabled`). Key hints (`Kbd`) are hidden on touch and below 900px.
  `FeedClient` also sets the Feed badge to the number of undecided artists.
- **`MiniPlayer`** (`components/player/mini-player.tsx`) — floating pill by default (play/pause,
  close, progress; slides in from below and leaves sliding down while fading, CSS keyframes in
  `globals.css`, staying mounted and inert until its exit ends; reduced motion: appears in place,
  fades out);
  `<MiniPlayer docked />` is the in-page player at the bottom of the desktop focus pane. While a
  docked one or the phone feed is mounted (`useSuppressFloatingPlayer`, a module-level count read
  with `useSyncExternalStore`) the floating pill renders nothing, so no route or width checks are
  needed.
- **`TrackStrip`** (`components/feed/track-strip.tsx`) — `ArtistCard`'s 1–3 playable tracks
  (a "View all tracks" button expands the rest); play button → `onPlay`. No network.
- **`CardArtist`** (`lib/cards/card-artist.ts`) — the one card view model (`ArtistWithTracks`
  + raw `artistColor` + `why {sourceArtists, genres}`). Assembled server-side by
  `lib/cards/feed-cards.ts` (Feed) and `lib/cards/explore-rail-payloads.ts` (Explore);
  `ArtistCard` takes it directly. Display colour always goes through
  `resolveArtistColor` (`lib/color-utils.ts`: sanitize; `#8b5cf6` sentinel/null → name hash).
- **`ExploreArtistRow`** — motion wrapper binding a `CardArtist` to `ArtistCard` (layout
  animation and entrance by transform only; none under reduced motion).
- **`ArtistSearch`** (`components/onboarding/`) — debounced (350ms), 2-char minimum, `GET /api/onboarding/
  search`; shows a "degraded" notice on Spotify rate-limit fallback.
- **`PlatformIcon`** — inline SVG per `spotify`/`apple_music`/`youtube_music`.

## Client hooks (`lib/hooks/`)

| Hook | State | API |
|---|---|---|
| `useFeedTriage` | selection, verdicts (from `useArtistFeedback`), saves, playback, undo toast | the feed's single triage object for desktop, tablet and Snap: `judge`, `undoLast`, `select`, `move`, `becomeCurrent`, `togglePlay`, `playTrack`, `save`, `share`, `artistLink`, `addTracks`; derived `selected`, `visible`, `remaining`, `total`, `counts`, `tuning`, `nowPlayingArtist` (details under Shared components) |
| `useFeedFill` | seen ids, counts | polls `GET /api/recommendations` (2.5s, assembled `CardArtist[]`) → append playable; stops at target / 3 idle / 60s (after one final poll, retried once after 1.5s if the fetch throws) |
| `useArtistTracks` | tracks | `GET /api/artists/:id/tracks?name=` (only if no baked tracks); `isFetching` is derived (true from the first render until the request settles) |
| `useArtistColor` | — | `useMemo`: sanitized hex or deterministic name-hash fallback |
| `useArtistFeedback` | `Map<id,signal>` | POST/DELETE `/api/feedback`, DELETE `/api/dismiss`; Explore `skip` is local-only. Controller `lib/client/artist-signals.ts`: optimistic at tap time, `railKey` captured at tap time, per-artist serialized, falls back to last confirmed value when the last queued call fails. `restore(id, previous)` (feed Undo) is optimistic too and picks the request(s) from the visible → previous transition (see the comment in the controller; skip → thumbs is DELETE dismiss then a best-effort POST, done once the DELETE succeeds) |
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

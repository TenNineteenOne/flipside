---
title: Pages, Components & Client Data Flow
updated: 2026-11-11
related: [[api-routes]], [[generation-engine]], [[settings-and-discovery]]
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
refine it. The old per-page radial "ambient" backgrounds (Saved, Settings) are gone; those
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
popularity meter and challenge bar get system colours, and the background-only controls (Snap
triage buttons, track chips, Play preview, the landing's primary buttons) a 1px `ButtonText` border.

## Screens (`app/(app)` + `app/(marketing)`)

| Screen | Loads | Client shell / notes |
|---|---|---|
| `/` (landing) | nothing: static, prerendered; never reads session, cookies or headers | `app/page.tsx` + `app/landing.css` (scoped under `.ev-landing`). Hero is `HeroStack` (`components/landing/hero-stack.tsx`) inside its own `AudioProvider`: six sample artists from `data/landing-sample.json` (the card throw and settle are CSS keyframes in `landing.css`, no framer-motion on this page; Less throws left, More right; a verdict given from the keyboard moves focus to the same button on the next card, a pointer verdict never moves focus) (regenerate with `npm run build:landing-sample`; `validateLandingSample` in `lib/landing/sample.ts` keeps every URL on the CSP's iTunes hosts). Signed-in visitors never see it: the proxy redirects `/` to `/feed` |
| `/sign-in` | — | username-only `signIn("credentials")` (Existing / New mode, `?mode=new` from the landing CTA), then `/api/onboarding/check` → onboarding or feed (`router.replace`); signed-in users are bounced to `/feed` by the proxy |
| `/onboarding` | — | artist search + genre picker + Last.fm/stats.fm usernames + platform; saves via `patchSettings` (`PATCH /api/settings`) + `POST /api/onboarding/seeds` (a different route from Settings' `/api/settings/seed-artists`); fire-and-forget first generate (`postGenerate`). Genres cap at 50; "Get started" is disabled while 1–2 artists are picked (the seeds route needs ≥3). `/feed` redirects here until onboarding is done |
| `/feed` | `recommendation_cache` (unseen, scored, ≤20), tracks cache, signal counts; empty → `RecommendationsLoader`; `loading.tsx` (re-exporting `FeedSkeleton`, `components/feed/feed-skeleton.tsx`) is a CSS-only skeleton per layout (desktop panes, tablet card + Up next, one Snap page, reserving the top bar's strip), so nothing shifts when the feed arrives | `FeedClient`: the desktop layout renders `FeedDesktop` (queue + focus pane), the tablet layout `FeedTablet`, otherwise `FeedSnap` (layout rule under Look; one tree, picked by a `matchMedia` `useSyncExternalStore`; each layout is a `next/dynamic` chunk with `FeedSkeleton` as its fallback, so a device downloads only its layout. The server and hydration render the layout guessed from the request (`guessFeedLayout`, `lib/feed/layout-guess.ts`: `Sec-CH-UA-Mobile`, else the user agent; Snap for phones, desktop otherwise) passed as `initialLayout` and returned as the server snapshot, so its chunk is preloaded; `feed.css` hides a server-rendered Snap or desktop tree wherever it is not the viewport's layout, and during the server render and hydration `FeedClient` renders `FeedSkeleton` beside it (`.ev-guess-skel`, `data-guess`) whose tree for the guessed layout never shows, so a wrong guess (every tablet in portrait, some Android tablets) shows the viewport's skeleton, never a blank area; after hydration the right layout's `loading` skeleton takes its place in the same frame. Each layout reports itself mounted (`onShown`) and `FeedShortcuts` ignores keys until the layout on screen is mounted. After the first layout has mounted, the load event and an idle callback, the three `dynamic()` loaders are run (kept by reference: a plain `import()` compiles to a separate copy of each chunk), so a later layout switch needs no network; a loader whose import fails (offline, or the chunk gone after a deploy) retries every 4s while the skeleton stays instead of reaching the error boundary. Art, `artistVar`, `EndState`, `LoadMore`, `CardActions` and `TrackList` live in `feed-parts.tsx`, shared by the three layouts); all read `useFeedTriage`, so resizing keeps selection, verdicts, saves and playback. Renders `CardArtist[]` from `loadFeedCards` (`lib/cards/feed-cards.ts`: tracks-cache fallback, colour lift, drop no-preview cards, `interleave()`); `useFeedFill` poll-append (same assembler via `GET /api/recommendations`), low-queue auto-generate. The weekly challenge (`ensureCurrentChallenge`, `lib/challenges/engine.ts`) is loaded unawaited by the page (`loadChallenge`; any failure resolves `null`) and passed as `challengePromise`; `FeedClient` renders `ChallengeSlot` in `Suspense` (fallback `ChallengeSkeleton`) and hands it to the layout as `challenge` |
| `/explore` | — | Removed 2026-11-10 (#205): `next.config.ts` `redirects()` sends `/explore` and `/explore/*` to `/feed` with a 308 |
| `/history` | seen recs + feedback/saves, derived `signal` | `HistoryClient`: filter tabs, time grouping; signal changes + undo/unblock via `useArtistFeedback` (`setSignal` / `removeSignal` / `dismiss`) |
| `/saved` | `saves` enriched from `recommendation_cache` | `SavedClient`: grid, optimistic unsave, open-in-platform + share |
| `/stats` | 6 parallel count queries + taste profile; `loading.tsx` draws the same boxes | `StatsClient` (see Shared components): totals, top genres, taste-profile panel (popularity scatter + sortable artist table) |
| `/settings` | decrypted usernames, source counts, seeds, example artists | `SettingsForm` → panels (Profile, Account, Platform, ConnectedSources, Seeds, Discovery) |

## Shared components

- **`AppShell`** (`components/shell/app-shell.tsx`, styles in `shell.css`) — signed-in chrome,
  rendered by `app/(app)/layout.tsx`. Desktop layout (≥900px wide, ≥540px tall): fixed left rail (Feed, History, Saved,
  Stats, Settings; 232px, icons-only 64px at 900–1099px). Otherwise: top bar (wordmark +
  identicon avatar (`IdenticonAvatar`: a seeded inline SVG from `lib/identicon.ts`, in the style of the DiceBear "shapes" avatar it replaced) menu button with Settings and Sign out via `next-auth/react` `signOut`; a
  state-driven menu, not the Popover API, so Safari before 17 works: `aria-haspopup="menu"` /
  `aria-expanded`, rendered only while open, focus moves in on open, closes on Escape (focus back
  to the button), outside pointer down, Tab out, item activation and route change, arrow keys move
  between items) and a four-item bottom tab bar (Feed, History, Saved, Stats). Which shows is CSS only.
  `aria-current="page"` when the path equals a link or starts with it plus `/`. Adventurous
  mode (`useAdventurousMode`) draws a solid 2px `--violet` line on the rail edge / on the phone tab bar's top edge.
  Pages hook in via `components/shell/shell-context.tsx`: `useShellBadge(href, n)` (nav count),
  `useShellShortcuts(fn)` (shows the rail's Shortcuts button), `<ShellSlot name="top"|"topSub"|"rail">` (topSub: an optional full-width second row under the phone top bar, hidden when empty)
  (portal into the top bar / under the rail nav). The rail shows at ≥900px wide and ≥540px tall,
  the top bar and tab bar otherwise (shell.css; the same desktop condition as the feed); the avatar
  menu closes itself when the rail appears (`matchMedia` change), so it never swallows a later
  Escape or reappears on narrowing. Page content keeps its 520px `.app-col`,
  unless its root has `.shell-fill` (desktop feed): then `.shell-main:has(.shell-fill)` drops the
  padding and column and is exactly viewport-high, so the page body never scrolls. A root with
  `.shell-wide` (Stats and its skeleton) leaves the 520px column from 900px and sets its
  own max-width, but keeps the shell's padding and normal page scrolling.

- **Dev preview** (`app/dev-preview/*`, `lib/dev-preview/fixtures.ts`) — development-only
  harness (404 in production) rendering the real shell and components with fixture artists and
  a stubbed same-origin `/api/*` fetch. Production code never imports it. Its layout passes
  `AppShell` `pathPrefix="/dev-preview"` so `/dev-preview/feed` marks Feed as current.
  The fixtures' 2nd artist has the 1st's first track as its third (a shared collaboration track id).
  `/dev-preview/feed?start=N` starts with N artists and the stub serves the rest in batches of 6
  per generate (exercises appends and Load more); `?real=1` swaps real-data shapes into a few rows
  (popularity 0, `alternative-metal`, `acro jazz laboratories`, a long name) and `?n=N` repeats the
  fixtures up to N artists (`realisticArtists` in `fixtures.ts`); `/dev-preview/feed` shows the challenge strip from `previewChallenge` (2/5; `?challenge=done` completed, `?challenge=none` hidden); `/dev-preview/feed-empty` and
  `/dev-preview/feed-loading` show the empty-feed loader and the loading skeleton;
  `/dev-preview/stats` is the real `StatsClient` (`lib/dev-preview/stats-fixtures.ts`;
  `?empty=1`, `?stress=1`) and `/dev-preview/stats-loading` its skeleton; `/dev-preview/shell` shows
  the shell around filler. The index page `/dev-preview` links every page. Its route files are
  `page.dev.tsx` / `layout.dev.tsx`, and `next.config.ts` adds `dev.tsx` to `pageExtensions`
  only outside production, so `next build` never compiles the harness (no route, no fixture
  data in any chunk); the layout's `notFound()` in production is a second guard. `tsconfig.json`
  excludes `.next/dev` because the dev route types (which include the harness) would otherwise
  clash with a production build's route types in `tsc` and in `next build`'s type check.
- **`StatsClient`** (`components/stats/stats-client.tsx`, styles `stats.css` under `.st`; root
  `.st.shell-wide`) — the feed-style header (plus a sentence linking to the feed on an empty account),
  then one column on phones, two from 900px (`5fr / 7fr`): totals as a definition list (label left,
  mono number right), top genres as ranked violet bars, and one "Your taste profile" panel. The panel
  has a legend (filled violet dot = saved, ring = liked), a figure whose `figcaption` gives the median,
  and a fluid SVG scatter (`role="img"`, `aria-label` with the count and median; x = popularity 0–100
  with gridlines and mono ticks, y a stable per-name jitter, each mark with a `<title>`). Under it the
  artist list is an ARIA table (`role="table"` / `rowgroup` / `row` / `columnheader` / `cell`):
  column labels Artist, Kind, Popularity, where only Popularity is a button (name "Popularity, sorted
  lowest first. Activate to sort highest first.", an up/down arrow for the current direction,
  `aria-sort` on its columnheader); the body rowgroup scrolls (max 360px) and is focusable. Numbers
  are formatted with one `Intl.NumberFormat("en-US")`, never the browser locale (a German browser
  would otherwise hydrate "1.234.567" against the server's "1,234,567").
- **`ChallengeStrip`** (`components/feed/challenge-strip.tsx`, styles `.ev-chal*` in `feed.css`;
  moved from the removed Explore page, #205) — the weekly challenge as one line ("**Weekly
  challenge** · like 5 artists this week": a fixed lead, not the template title, which the payload
  no longer carries; a visually hidden ":" for screen readers), a mono `2/5`
  count (check mark once completed) and a thin `--wander-rainbow` bar; `aria-label="Weekly
  challenge"`. Desktop: a light line (text, count, 3px bar; no panel) in the queue header's Load more row
  (`.ev-wander-chal`, left of Load more + the switch; the Wander note sits right-aligned under the
  controls); below a 560px queue container it takes its own line above the controls. Tablet: a
  full-width line in its own grid row (`.ev-t-chal`). Phone: a 36px line inside `.ev-snap` under
  the top bar (the scroller shrinks, so `--ev-snap-top` is unchanged; hidden below 480px tall); the text
  ellipsizes, the count never does. Progress is incremented server-side by `POST /api/feedback`
  on a thumbs-up; the strip shows it on the next page load or `router.refresh()` (Load more), not live.
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
- **Phone top bar** (`TopBarProgress` in `feed-snap.tsx`, `controls={false}` on phones): wordmark and
  avatar only, plus the segment strip row. Load more and Wander farther live in the end state
  (`EndState` → `LoadMore` with the switch) and Settings; the tablet keeps them in its top bar.
- **Focus pane (desktop)**: banner art (height `clamp(220px, 100vh - 362px, 560px)`) with the name
  and genres over its lower edge, the "Because you like" line, one row of six even icon columns with
  one-word labels (Less, Skip, More, Save, the Open-in app, Share; full phrases in `aria-label`/`title`),
  then the three previews, which are the play controls (no separate Play button; Space still toggles).
- **Share** (`useFeedTriage.share`): `navigator.share({ url })` with just the artist link, else copy it.
- **`FeedDesktop`** (`components/feed/feed-desktop.tsx`, styles `feed.css` under `.ev-feed`) —
  queue column (sticky header: the title takes the width, and the segment strip (count in its
  `aria-label` only; no visible "N of M left") sits in a 260px column beside them when the queue is at least
  660px wide, otherwise on its own line below, decided by a container query on `.ev-queue`, so the
  header is 102px or 130px whatever the artist count; strip segments flex between 2px and 9px in one
  row and the gaps shrink to 0 past ~80 artists (`--n` on the strip); the skeleton has the same
  structure, so its header height always matches. A `ResizeObserver` writes the header's height to
  `--ev-head-h` on the queue; the sticky column label row (`QueueColumns`, `feed-skeleton.tsx`, shared
  with the skeleton: Artist / Genre / "Popularity 0–100", the hint "Lower means more obscure" as
  visually hidden text only, on the rows' own grid (`--ev-cols`) so labels can't drift; hidden while
  no rows are visible). Which columns show follows the queue's own width (container queries on
  `.ev-queue`, not the viewport, since the rail and focus pane also take width): Popularity from a
  530px queue, Genre from 680px, so the Artist column never shrinks below ~260px to make room for
  them; labels, row cells and the skeleton's labels hide together. The label row sticks at `top: var(--ev-head-h)`, and the queue's `scroll-padding-top` (header + label
  row) keeps keyboard focus, undo reselect, J/K and row clicks clear of both. Rows: art (play), name
  (ellipsis) and reason, genre (`title` holds the full genre), popularity meter and number
  (visually hidden "Genre:" / "Popularity: … out of 100"), Liked / Saved tag; a passed or dismissed row fades and slides out via
  `useLeaving`, `lib/hooks/use-leaving.ts`, and a CSS keyframe) and focus pane (artwork via `artworkFor` or a
  letter panel, why, popularity, Play preview, the three triage buttons, Save / Open in
  {platform} / Share, up to three preview tracks (styled like the Snap track chips: each in its own
  `chipColors` colour with a play circle), docked player; the end-of-queue state with
  counts and "Load more artists" when nothing is selected; `LoadMore` is `aria-disabled` with clicks
  ignored while generating, never `disabled`, so keyboard focus stays on it), the weekly challenge in the header's
  Load more row, and the rail "Tuning" block
  via `<ShellSlot name="rail">`. No decision logic. `FeedClient` sets the Saved badge
  (`useShellBadge`) to saves made since the feed opened. `Art` (`feed-parts.tsx`) fetches Apple (`*.mzstatic.com`)
  artwork at three times its display size up to 64px (sharp thumbnails on 3x phones) and twice above
  (`artworkAt`, `lib/feed/artwork.ts`; never above the stored size; Spotify `i.scdn.co` URLs pass
  through), and the selected artist's art (focus pane, first Snap card) with
  `fetchPriority="high"`; the other thumbnails (landing queue, mini players, track strip,
  history, onboarding search) use the same helper.
- **`FeedSnap`** (`components/feed/feed-snap.tsx`) — phones below 640px, and every viewport too
  short for the tablet or desktop layout (phones in landscape at any width, browser zoom): a fixed column between
  the shell top bar and tab bar (the page body does not scroll): the weekly challenge line, a vertical
  scroller with mandatory snapping, one full-height page per loaded artist (decided ones included,
  feed order) plus a final end page (`EndState`, "Load more artists") that is always there, so Load
  more is reachable with artists still unrated (it then reads "N not rated yet." with "Rate the rest",
  which jumps to the first unrated; scrolling onto it holds via the hook's `END_PAGE` selection), a
  small player bar (the docked `MiniPlayer`) only while the loaded track is not the artist on
  screen. There is no separate triage bar: each card carries its own actions. On phones
  (`controls={false}`) `TopBarProgress` puts only the segment strip in `<ShellSlot name="top">`,
  between the wordmark and the avatar (`flex: 1`), and leaves `topSub` empty, so the top bar is one
  56px row (`--ev-snap-top` = top bar + safe area + 1px border). On tablets it fills `<ShellSlot name="top">` with the
  Wander farther switch (label "Wander" below 440px, track only below 360px; accessible name
  always "Wander farther"), a header Load more (a 40px icon button with the accessible name
  "Load more artists", icon + "Load more" from 600px; rainbow while Wander farther is on;
  `aria-disabled` and named "Generating…" while generating), and the segment
  strip goes in `<ShellSlot name="topSub">`. Measured in the dev preview, the bar fits at 320px
  with two-digit counts (5px spare); a three-digit count at 320px would crowd the wordmark. An `IntersectionObserver` (scroller root, threshold 0.6)
  calls the hook's `becomeCurrent(id | null)` (null = end page), which also hands playback over
  (`shouldHandOver`, `lib/feed/hand-over.ts`: only while another artist's track is playing); any
  other selection change (decision advance, J/K, undo, an append after the end) scrolls that page
  into view, ignoring observer callbacks for other pages until `scrollend` (timeout fallback).
  When that scroll ends, and whenever the scroller changes size (`ResizeObserver`: the player bar
  showing or leaving during a hand-over), the selected page is put exactly in view instantly, as
  browsers do not re-snap after a size change.
  Each page renders **`SnapCard`** (`components/feed/snap-card.tsx`, shared with the tablet
  layout) in the desktop focus card's order: artwork filling the height left (`flex: 1`, at least
  160px, `object-fit: cover`) with the name (26px) and genres (one line, ellipsis) over its lower
  edge on a dark gradient; the why sentence (two lines at most); the six-action icon row and the
  previews, both the desktop card's own components (`CardActions` and `TrackList` in
  `feed-parts.tsx`: Less, Skip, More/Liked, Save/Saved, Open in {platform}, Share; up to three
  full-width track rows, each outlined in a colour from `chipColors` in `lib/color-utils.ts`, with
  the playing row's progress bar). On cards the buttons are 48px tall and track rows 44px with the
  album line hidden. There is no play button on the artwork: the track rows, Space and the other
  shortcuts play. "Loading tracks…" / "No preview available" take the rows' place; artists without
  tracks fetch them (`useArtistTracks`) only while selected. Measured at 375×690: art 329×267,
  card bottom 10px above the tab bar.
  Short pages (container queries on the page, `ev-page`): below 470px the artwork may shrink to
  96px, below 410px the previews go, below 260px the why line goes (artwork down to 64px), so name,
  genres and the icon row stay whole; wide short Snap pages (landscape, ≥560px wide and <356px
  tall) put a square artwork beside the rest (previews back from 290px, why from 150px). The tablet
  stage, also an `ev-page` container, keeps the card upright at any width. Under 480px of viewport
  height the challenge line is hidden.
  Programmatic scrolls measure offsets from the scroller (`el.offsetTop - root.offsetTop`).
  Swipe (framer-motion `drag="x"`, direction lock, `touch-action: pan-y pinch-zoom` set in CSS over
  framer's inline `pan-y`; a `pointercancel` / `touchcancel` never commits): past 96px, or a flick
  past 40px over 500px/s, unless released with a flick back over 500px/s (`swipeDirection`,
  `lib/feed/swipe.ts`), right = `thumbs_up`, left =
  `thumbs_down` via `judge(…, { toggle: false, advance: true })`; the card springs back to rest in
  place (`dragSnapToOrigin`) while the scroller moves on, and ignores drags until at rest. Violet /
  dark labels fade in from 24 to 96px. Decided cards show a "Liked" badge, or dimmed artwork with a
  "Less like this" / "Dismissed" badge, at the artwork's top left (icon only on artwork under
  120px tall). Reduced motion: no rotation or spring, instant scroll.
  The floating pill is hidden while the feed is mounted (`useSuppressFloatingPlayer`); the undo
  toast sits above the tab bar (and the player bar when shown).
- **`FeedTablet`** (`components/feed/feed-tablet.tsx`) — 640–899px and at least 680px tall: the selected artist's
  `SnapCard` (swipeable, entrance scale-up, next undecided artist as a ghost behind it) in a size
  container (the card fills the stage's height and carries its own actions; no separate triage
  bar), and a 280px "Up next" list of every loaded artist
  in feed order (thumbnail, name, first genre; violet heart badge when liked, dimmed with an X when
  passed/dismissed; `aria-current` on the selected row; tap selects; scrolls on its own and keeps
  the selected row centred; "Load more artists" is always its last item, as it is at the end of
  the desktop queue column). Shares `TopBarProgress` and `PlayerBar`
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
- **`CardArtist`** (`lib/cards/card-artist.ts`) — the one card view model (`ArtistWithTracks`
  + raw `artistColor` + `why {sourceArtists, genres}`). Assembled server-side by
  `lib/cards/feed-cards.ts`; the Feed card components take it directly. Display colour always goes through
  `resolveArtistColor` (`lib/color-utils.ts`: sanitize; `#8b5cf6` sentinel/null → name hash).
- **`ArtistSearch`** (`components/onboarding/`) — debounced (350ms), 2-char minimum, `GET /api/onboarding/
  search`; shows a "degraded" notice on Spotify rate-limit fallback.
- **`PlatformIcon`** — inline SVG per `spotify`/`apple_music`/`youtube_music`.

## Client hooks (`lib/hooks/`)

| Hook | State | API |
|---|---|---|
| `useFeedTriage` | selection, verdicts (from `useArtistFeedback`), saves, playback, undo toast | the feed's single triage object for desktop, tablet and Snap: `judge`, `undoLast`, `select`, `move`, `becomeCurrent`, `togglePlay`, `playTrack`, `save`, `share`, `artistLink`, `addTracks`; derived `selected`, `visible`, `remaining`, `total`, `counts`, `tuning`, `nowPlayingArtist` (details under Shared components) |
| `useFeedFill` | seen ids, counts | polls `GET /api/recommendations` (2.5s, assembled `CardArtist[]`) → append playable; stops at target / 3 idle / 60s (after one final poll, retried once after 1.5s if the fetch throws) |
| `useArtistTracks` | tracks | `GET /api/artists/:id/tracks?name=` (only if no baked tracks); `isFetching` is derived (true from the first render until the request settles) |
| `useArtistFeedback` | `Map<id,signal>` | POST/DELETE `/api/feedback`, DELETE `/api/dismiss`. Controller `lib/client/artist-signals.ts`: optimistic at tap time, per-artist serialized, falls back to last confirmed value when the last queued call fails. `restore(id, previous)` (feed Undo) is optimistic too and picks the request(s) from the visible → previous transition (see the comment in the controller; skip → thumbs is DELETE dismiss then a best-effort POST, done once the DELETE succeeds) |
| `useArtistSaves` | `Set<id>` | POST/DELETE `/api/saves`; same artist-signal controller |
| `useAdventurousMode` | bool | `localStorage` + cross-tab sync + `patchSettings` |
| `useFeedGeneration` | generating | the only `POST /api/recommendations/generate` caller with a guard (`lib/client/feed-generation.ts`): `requestMore` (feed top-up / Load more). `release()` (unmount) reports generating=false and silences the abandoned run; the feed skips `router.refresh()` after unmount. Loader/onboarding use its `postGenerate` + `classifyGenerate` |

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

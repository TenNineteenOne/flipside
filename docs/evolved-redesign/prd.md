# PRD: Evolved redesign (landing, app shell, feed on desktop and phone)

> Draft for review. Publishes to the issue tracker with the `ready-for-agent` label once approved.
> Written to be implemented by an agent that has not seen the design conversation. Where this PRD
> and the prototype disagree, **this PRD wins**; where this PRD is silent, **copy the prototype**.

## Problem Statement

Flipside's landing page shows nothing and plays nothing: a stranger sees a headline and a button and
must sign up before learning what the product is. Once signed in, the app is a single 520px column
on every screen, so a desktop monitor is mostly empty and a phone gets a long scroll of tall cards.
Each artist card stacks six full-width buttons of equal weight, so the three decisions that matter
(more like this, less like this, dismiss) are hard to find and slow to use. Every card carries a
30px backdrop blur and the whole page sits under a full-screen grain layer, which makes scrolling
janky on mid-range phones. Four font families load on every page. The result looks like a generic
dark template and does not hold up in front of a large audience.

## Solution

Ship the "Evolved" direction that was prototyped and chosen on 2026-11-09:

- **Landing page:** the hero is a real, playable artist card. A stranger hears an artist they have
  never heard in one tap, with no account. The page is a static file.
- **App shell:** a left navigation rail on desktop and a bottom tab bar on phones replace the
  current top nav on every signed-in page.
- **Feed on desktop:** three panes. A navigation rail, a compact queue of artists, and a focus pane
  for the selected artist with large artwork, the reason it was recommended, three preview tracks
  and one clear triage control. A docked player sits under the focus pane. Everything is operable
  from the keyboard.
- **Feed on phones ("Snap"):** one artist per screen. Scrolling up and down moves between artists
  and snaps to each one. Swiping a card sideways, or tapping one of three large buttons in the thumb
  zone, records the decision. Decided artists stay in the scroll, marked, so scrolling back works.
- **Feed on tablets:** the single-artist card beside a vertical "Up next" list.
- **Look:** the same dark surface and violet accent, with each artist's own colour tinting their
  card. No glow, no blur, no grain. Two font families instead of four.

Everything else in the app (recommendation engine, API routes, database, auth, Explore's rails,
History, Saved, Stats, Settings, onboarding, sign-in) keeps its current behaviour. Those pages get
the new shell, colours and fonts but no layout redesign.

## User Stories

Visitors (not signed in)

1. As a visitor, I want to see a real artist card on the landing page, so that I understand what Flipside is before signing up.
2. As a visitor, I want to press play on that card and hear a 30-second preview, so that I can judge the product in seconds.
3. As a visitor, I want to tap "More like this" or "Less like this" on the sample card and get the next sample artist, so that I can feel the core loop.
4. As a visitor, I want a clear primary button that takes me to sign-up, so that I can start when I am convinced.
5. As a visitor, I want to see that sign-up needs only a name (no email, no password, no listening history), so that I trust the low commitment.
6. As a visitor, I want a short explanation of how it works shown with real interface pieces, so that I do not have to read marketing copy.
7. As a visitor on a phone, I want the headline, the sign-up button and the play button all visible without scrolling, so that the first screen is enough.
8. As a visitor on a slow connection, I want the landing page to load as a static page, so that it appears quickly.
9. As a visitor whose browser fails to play a preview, I want the card to stay usable and not show a stuck "playing" state, so that the page does not look broken.

Signed-in listeners: navigation and shell

10. As a listener on desktop, I want a navigation rail with Feed, Explore, History, Saved, Stats and Settings, so that I can move between sections without losing vertical space.
11. As a listener on a phone, I want a bottom tab bar with Feed, Explore, History, Saved and Stats, so that navigation is under my thumb.
12. As a listener on a phone, I want Settings and Sign out behind an avatar button in the top bar, so that the tab bar stays at five items.
13. As a listener, I want the current section highlighted in the navigation, so that I know where I am.
14. As a listener, I want the Saved item to show how many artists I have saved this session, so that saving feels acknowledged.
15. As a listener with adventurous mode on, I want the shell to still indicate it, so that I remember the mode is active.
16. As a listener on a phone with a notch or home indicator, I want the bars to respect the safe areas, so that controls are not hidden.

Signed-in listeners: feed on desktop

17. As a listener on desktop, I want a queue of today's artists in the centre, so that I can see what is coming.
18. As a listener on desktop, I want the selected artist shown large on the right with artwork, genres and the reason it was picked, so that I can decide with context.
19. As a listener, I want one obvious play button for the selected artist, so that listening is the first action.
20. As a listener, I want to switch between the artist's three preview tracks, so that I am not judging on one song.
21. As a listener, I want "Less like this", "Dismiss" and "More like this" as one compact control, so that the three decisions are easy to find.
22. As a listener, I want the feed to move to the next undecided artist after I decide, so that I can keep going without extra clicks.
23. As a listener who is playing a preview when I decide, I want the next artist's preview to start automatically, so that the music does not stop while I triage.
24. As a listener, I want a five-second Undo after each decision, so that a mis-click costs nothing.
25. As a listener, I want artists I passed or dismissed to leave the desktop queue, so that the queue shows only what is left and what I liked.
26. As a listener, I want artists I liked to stay in the queue with a clear "Liked" mark, so that I can go back and listen again.
27. As a listener, I want to un-like an artist by pressing "More like this" again, so that I can change my mind later.
28. As a listener, I want to see "7 of 19 left" and a segmented progress strip, so that I know how far through today's batch I am.
29. As a listener, I want to save an artist, open them in my preferred music service, and share a link from secondary buttons, so that those actions exist without competing with triage.
30. As a listener, I want the docked player to show what is playing with play/pause and progress, so that I can control audio while browsing the queue.
31. As a listener, I want a "Tuning" summary of genres my decisions lean toward and away from, so that I can see my feedback having an effect.
32. As a listener, I want a designed end-of-queue state with my counts and a button to get more artists, so that finishing a batch feels complete and I can continue.
33. As a listener, I want new artists that arrive in the background to be appended to the end of the queue without moving my place, so that loading never disrupts what I am doing.
34. As a new listener with little feedback yet, I want the existing cold-start hint to still appear, so that I know why early picks are broad.

Signed-in listeners: keyboard

35. As a keyboard user, I want J/K or the arrow keys to move through the queue, so that I never need the mouse.
36. As a keyboard user, I want Space to play or pause and 1, 2, 3 to play a specific track, so that listening is one key.
37. As a keyboard user, I want L, X and D for more, less and dismiss, so that triage is one key.
38. As a keyboard user, I want B to save, O to open in my music service, S to share and Z to undo, so that every action has a key.
39. As a keyboard user, I want "?" to open a list of shortcuts, so that I can learn them.
40. As a keyboard user, I want shortcuts ignored while I am typing in a field, so that typing never triggers actions.
41. As a desktop user, I want small key hints next to the main controls, so that I discover the shortcuts.

Signed-in listeners: feed on phones (Snap)

42. As a listener on a phone, I want one artist to fill the screen with large artwork, so that the music is the focus.
43. As a listener on a phone, I want to scroll vertically between artists with the page snapping to each one, so that browsing feels natural.
44. As a listener on a phone, I want three large buttons above the tab bar for less, dismiss and more, so that I can decide with my thumb.
45. As a listener on a phone, I want to swipe a card right for "more like this" and left for "less like this", so that deciding is a gesture.
46. As a listener on a phone, I want a coloured label to appear on the card as I swipe past the point of no return, so that I know what releasing will do.
47. As a listener on a phone, I want a short swipe to spring back, so that accidental touches do nothing.
48. As a listener on a phone, I want the feed to scroll to the next undecided artist after I decide, so that I keep moving.
49. As a listener on a phone, I want decided artists to stay in the scroll with a visible badge, so that I can scroll back and revisit them.
50. As a listener on a phone, I want scrolling past an artist without deciding to be allowed, so that I am never forced to judge.
51. As a listener on a phone, I want the preview to hand over to the artist that snaps into view if something was already playing, so that the audio follows what I am looking at.
52. As a listener on a phone, I want a play button on the artwork with a ring that fills over 30 seconds, so that progress is visible on the thing I tapped.
53. As a listener on a phone, I want the Undo message to appear above the triage buttons, so that it never covers them.
54. As a listener on a phone, I want a small player bar only when the playing artist is not the one on screen, so that I can stop audio I can no longer see.
55. As a listener on a phone, I want everything for one artist to fit without scrolling inside the card on small phones (375x667), so that controls are never cut off.

Signed-in listeners: tablets, accessibility, quality

56. As a listener on a tablet, I want the artist card beside a vertical "Up next" list, so that the wider screen is used.
57. As a listener using a screen reader, I want every control to be a labelled button or link, so that I can triage without sight.
58. As a listener who prefers reduced motion, I want decisions to apply without fling or spring animations, so that the interface does not trigger discomfort.
59. As a listener on a mid-range phone, I want scrolling to stay smooth, so that the app feels fast.
60. As a listener, I want artists without a photo to still look intentional, so that missing images do not look like errors.
61. As a listener, I want Explore, History, Saved, Stats and Settings to keep working exactly as before inside the new shell, so that the redesign does not cost me features.
62. As the owner, I want the redesign built from small independent issues with tests, so that a lower-tier coding agent can implement each one safely.

## Implementation Decisions

### Ground rules

- **Reference implementation.** A working prototype lives on branch `design-lab` under the route
  `/lab/evolved` (landing) and `/lab/evolved/app` (feed). It uses mock data and local state. Its
  markup, CSS, spacing, copy, animation timings and breakpoints are the visual specification. Its
  data layer is not: the real app's hooks and API routes must be used.
  Prototype sources: `app/lab/evolved/` (layout, pages, `evolved.css`) and
  `components/lab/evolved/` (`discover.tsx`, `mobile-shell.tsx`, `hero-stack.tsx`, `shared.tsx`).
  (File paths are given deliberately, against the usual PRD convention, because the implementer may
  be a lower-tier model and the prototype branch is frozen.)
- **Base branch.** Implementation branches off `Nick` (the active development branch, 106 commits
  ahead of `main`), not `main` and not `design-lab`.
- **No new dependencies.** `framer-motion`, `lucide-react`, `sonner` and `next/font` are already
  installed and are sufficient.
- **Next.js 16.** Read the relevant guide in `node_modules/next/dist/docs/` before writing code, as
  the repository's agent rules require.
- **No backend changes.** No migrations, no new API routes, no changes to the recommendation
  engines, auth, cron jobs, or Content-Security-Policy.
- **The `/lab` routes and `lib/lab`, `components/lab` are not part of this work** and must not be
  imported by production code. Copy what is needed into production locations.

### Scope by surface

| Surface | Change |
|---|---|
| Landing page | Rebuilt: static, playable hero card, three-step explainer, sign-up promise |
| Root layout | Fonts reduced to two families; grain overlay removed |
| Signed-in layout | New shell: navigation rail (desktop), top bar + tab bar (phone/tablet), docked/mini player |
| Feed | Rebuilt: three-pane desktop, Snap on phones, card + list on tablets |
| Explore | Keeps its rails and the existing artist card. The card loses its backdrop blur and inherits new fonts and colours. No layout change |
| History, Saved, Stats, Settings, onboarding, sign-in | New shell, fonts and colours only |

### Breakpoints

| Width | Layout |
|---|---|
| below 640px | Phone: Snap feed, top bar, tab bar |
| 640–899px | Tablet: single-artist card + 280px vertical "Up next" list, top bar, tab bar |
| 900–1099px | Desktop with the navigation rail collapsed to icons |
| 1100–1279px | Desktop, full rail, genre column hidden in queue rows |
| 1280px and up | Desktop, full layout |

Only the Snap view ships on phones. The prototype's other phone views (`card`, `list`, `queue`) and
its "Layout" switcher row are **not** shipped. The tablet layout uses the prototype's `card` view
with the vertical list, exactly as the prototype does at 640–899px.

### Design tokens (from the prototype; these are decisions, copy the values)

```css
--bg: oklch(0.155 0.007 293);        /* page */
--rail: oklch(0.135 0.007 293);      /* nav rail, bars */
--panel: oklch(0.185 0.008 293);     /* cards, panes */
--raise: oklch(0.225 0.01 293);      /* hover, raised controls */
--line: oklch(0.27 0.01 293);
--line-strong: oklch(0.36 0.012 293);
--fg: oklch(0.965 0.004 293);        /* primary text */
--fg-2: oklch(0.82 0.008 293);       /* secondary text */
--fg-3: oklch(0.68 0.01 293);        /* tertiary text; do not go dimmer for body copy */
--violet: #8b5cf6;                   /* the one brand accent */
--violet-hi: oklch(0.66 0.2 293);
--violet-ink: oklch(0.8 0.12 293);   /* violet text on dark, focus rings */
--violet-wash: color-mix(in oklch, #8b5cf6 16%, transparent);
--ease: cubic-bezier(0.16, 1, 0.3, 1);
```

- Violet is used only for: the primary call to action, the liked state, "more" chips, focus rings.
- Per-artist colour is exposed as the CSS custom property `--a` on the artist's card or pane.
  Production has a single colour per artist (nullable), not the prototype's three. Resolve it with
  the existing artist-colour hook (which sanitises and falls back to a name hash), then derive:
  `--a-dark: color-mix(in oklch, var(--a) 45%, black)` and
  `--a-light: color-mix(in oklch, var(--a) 55%, white)`.
- The existing token names in the global stylesheet (`--bg-base`, `--bg-card`, `--text-primary`,
  `--accent`, and the shadcn mappings) stay defined and are **re-pointed** at the new values, so
  untouched pages pick up the new palette without edits. New names above are added alongside.
- Remove the full-screen grain overlay (`body::after`) and its `--grain-opacity` token.
- Remove `backdrop-filter` from cards everywhere, including the inline style block in the root
  layout and the existing artist card. Bars may use a solid `--rail` background instead of blur.

### Typography

- Two families via `next/font/google`: **Familjen Grotesk** (variable weight, subsets latin and
  latin-ext) for all text, and **Martian Mono** (weights 400 and 500) for key hints, durations and
  counts only.
- Fraunces, Instrument Serif, JetBrains Mono and Inter are removed from the root layout.
- The existing CSS variables keep their names and are re-pointed: `--font-sans` and
  `--font-display` to Familjen Grotesk, `--font-mono` to Martian Mono. `--font-serif` is re-pointed
  to Familjen Grotesk and the `.serif` utility loses its italic, so existing markup keeps working.
  The `--font-display-settings` variable axes (`SOFT`, `WONK`, `opsz`) are removed.
- Wordmark: lowercase "flipside" followed by a small violet dot, weight 650, letter-spacing
  -0.035em.
- Body text is at least 15px on desktop and 16px on phones. Line length is capped near 70 characters.

### Vocabulary and signal mapping

The interface says **More like this**, **Less like this** and **Dismiss**. These map to the existing
feedback signals. Internal verdict names from the prototype are shown for reference.

| Interface label | Verdict (prototype) | Feedback signal (production) | Leaves desktop queue? |
|---|---|---|---|
| More like this | `liked` | `thumbs_up` | No, stays and is marked "Liked" |
| Less like this | `passed` | `thumbs_down` | Yes |
| Dismiss | `dismissed` | `skip` | Yes |

All three are sent through the existing artist-feedback hook (`setSignal`). The Feed posts all three
to the server (it does not treat `skip` as local-only; that is Explore's behaviour).

Undo, per verdict, using the same hook:

| To undo | Call |
|---|---|
| More like this | `setSignal(artistId, "thumbs_up")` again (the hook treats a repeat as a delete) |
| Less like this | `removeSignal(artistId)` |
| Dismiss | `dismiss(artistId)` |

Pressing "More like this" on an already-liked artist un-likes it in place (no advance). Swiping
right on an already-liked artist does nothing (it must not un-like).

The verdict shown in the interface is always derived from the hook's `signals` map. The feed does
not keep a second copy of verdicts.

### Data mapping: prototype mock artist to production card artist

The prototype's mock artist type and the production card view model differ. Use this table.

| Prototype field | Production source |
|---|---|
| `id` | card artist `id` (internal artist UUID) |
| `name`, `genres`, `popularity` | same names on the card artist |
| `imageUrl` (always present) | **Artwork resolver** (below); `imageUrl` is often null in production |
| `color`, `colorDark`, `colorLight` | resolved artist colour, then CSS derivation (above) |
| `why.sourceArtists`, `why.genres` | same |
| `topTracks` (always 3) | `topTracks`, which may be empty at first; use the existing artist-tracks hook exactly as the current card does. Show 0 to 3 tracks |
| `spotifyUrl(a)` | existing artist-link helper with the user's preferred music platform; label and icon come from the existing platform metadata ("Open in Apple Music", etc.) |
| share URL | existing shareable-link helper, then `navigator.share` when available, else copy to clipboard |

### Modules

Deep, framework-free modules (tested in isolation):

1. **Triage queue** (pure functions; no React, no network). Given the ordered list of artist ids,
   the current signals map and the selected id, it answers every "what next" question. Interface
   (shape taken from the prototype's logic, simplified):

   ```ts
   type Signal = "thumbs_up" | "thumbs_down" | "skip"
   type Signals = ReadonlyMap<string, string>

   /** Artists still shown in the desktop queue: undecided + liked, in original order. */
   function visibleQueue(ids: readonly string[], signals: Signals): string[]
   /** Count of undecided artists. */
   function remaining(ids: readonly string[], signals: Signals): number
   /** { liked, passed, dismissed } */
   function counts(ids: readonly string[], signals: Signals): { liked: number; passed: number; dismissed: number }
   /** Next undecided artist after `fromId`, wrapping once; null when none are left. */
   function nextUndecided(ids: readonly string[], signals: Signals, fromId: string): string | null
   /** Neighbour in the visible queue for keyboard movement; clamps at both ends. */
   function step(ids: readonly string[], signals: Signals, selectedId: string | null, dir: 1 | -1): string | null
   /** First undecided artist, or null. Used for the initial selection. */
   function firstUndecided(ids: readonly string[], signals: Signals): string | null
   ```

   `nextUndecided` is evaluated against the signals **as they will be after** the decision being
   made, so the artist just judged is never returned.

2. **Feed keymap** (pure). Maps a key press plus context to an action name, or nothing.

   ```ts
   type FeedAction =
     | "next" | "prev" | "togglePlay" | "track1" | "track2" | "track3"
     | "more" | "less" | "dismiss" | "save" | "open" | "share" | "undo" | "toggleHelp"

   function feedAction(e: {
     key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean
     targetIsEditable: boolean      // input, textarea, select, contenteditable
     targetIsButtonOrLink: boolean  // Space must not double-fire on a focused control
     helpOpen: boolean
   }): FeedAction | null
   ```

   Bindings: `j` / ArrowDown next · `k` / ArrowUp previous · Space play/pause · `1` `2` `3` tracks ·
   `l` more · `x` less · `d` dismiss · `b` save · `o` open · `s` share · `z` undo · `?` (or Shift+/)
   help. Returns null when any of meta/ctrl/alt is held, when the target is editable, or when help is
   open (except `toggleHelp`). Space returns null when the target is a button or link.

3. **Artwork resolver** (pure). `artworkFor(artist)` returns the first available of: the artist's
   `imageUrl`; the first track's album image; otherwise null. When null, the interface shows a solid
   panel in the artist's colour with the artist's first letter. No broken-image icons, ever.

4. **Card copy helpers** (pure): the "why" sentence, the popularity label and track duration.
   - Why: with source artists, "Because you like A", "Because you like A and B",
     "Because you like A, B and C"; with none, "Because you like genre1, genre2"; with neither,
     no sentence is shown. Source-artist names are rendered bold.
   - Popularity label thresholds (prototype): below 35 "Barely charted", below 45 "Deep cut",
     below 52 "Under the radar", otherwise "Cult following". Thresholds live in one constant so
     they can be tuned against real data.
   - Duration: `m:ss`.

5. **Landing sample** (static data + validator). A small JSON file of six curated artists with
   name, genres, why, artwork URL, colour and one to three preview tracks, generated by a script
   from the public iTunes search API (the prototype's `scripts/lab-fetch-artists.mjs` is the
   starting point). A validator function checks the shape and that every URL is on an allowed host
   (`*.mzstatic.com`, `audio-ssl.itunes.apple.com`), matching the existing Content-Security-Policy.

React-level modules:

6. **Feed triage hook.** The single place that combines: the triage queue functions, the existing
   artist-feedback hook, the existing artist-saves hook, the audio context, selection state, and the
   undo toast. Every presentation (desktop, Snap, tablet) receives the same object from it and
   contains no decision logic of its own. Responsibilities:
   - `judge(artistId, signal, { toggle, advance })`: apply the signal; when `advance` is true and
     the artist is the selected one, select `nextUndecided`; if that artist was playing, start the
     next artist's first track (or pause when none is left); show the undo toast.
   - `undo()` for the most recent decision (table above), then reselect that artist.
   - `select(id)`, `move(±1)`, `togglePlay(artist)`, `playTrack(artist, index)`,
     `toggleSave(artist)`, `open(artist)`, `share(artist)`.
   - `becomeCurrent(id)` for Snap: select the artist that scrolled into view; if something is
     playing and belongs to a different artist, start this artist's first track.
   - Derived values: `selected`, `visible`, `remaining`, `total`, `counts`, `tuning` (genres of
     liked artists as "more", up to six; genres of passed artists as "less", up to four),
     `nowPlayingArtist`.
7. **App shell.** Navigation rail, top bar, tab bar, avatar menu. Replaces the current top nav in
   the signed-in layout. Keeps the existing navigation-progress indicator and the existing
   adventurous-mode hook; adventurous mode is shown as a thin multi-colour line on the rail's inner
   edge (desktop) and under the top bar (phone/tablet), replacing today's line under the top nav.
8. **Player.** The existing mini player gains a docked variant for the desktop focus pane. On
   phones the mini player appears only when the playing artist is not the one on screen.
9. **Desktop feed:** queue (rows), focus pane, triage control, track list, progress strip, tuning
   summary, end-of-queue state, shortcut sheet.
10. **Snap feed:** vertical scroller, snap card (shared with tablet), fixed triage bar.
11. **Landing:** hero card stack, three-step explainer, sign-up promise, footer.

### Feed behaviour details

- **Initial selection:** the first undecided artist.
- **Auto-advance:** after any of the three decisions on the selected artist, select the next
  undecided artist. Decisions made on a non-selected artist (a quick action in a list) never move
  the selection.
- **Keep playing:** if the artist being decided is the one currently playing, the next selected
  artist's first track starts. If no artist is left, audio pauses.
- **Undo toast:** uses the existing toast system with an "Undo" action, visible for five seconds.
  Text: "More like {name}", "Less like {name}", "Dismissed {name}", "Removed like from {name}",
  "Saved {name}", "Removed {name} from Saved", "Link to {name} copied". On phones the toast sits
  above the triage bar and never covers it.
- **Desktop queue rows:** artwork thumbnail (also a play/pause control), name, the why line, first
  genre (hidden below 1280px), a "Liked" tag when liked. Passed and dismissed rows animate out and
  the list closes up. The selected row is highlighted and kept in view when moving by keyboard.
- **Progress:** "N of M left" where M is the number of artists loaded this session and N the number
  undecided, plus a strip of M segments coloured by verdict (current = white, liked = violet,
  passed/dismissed = dim). M grows when artists are appended.
- **Growing list:** the existing background fill hook appends new artists to the end. Appends never
  change the selection, the scroll position or the order of existing artists.
- **Low-queue top-up on load** and its guard logic are kept exactly as they are today.
- **End of queue:** shown when no undecided artist is left. Contains up to four liked artworks,
  "You've heard all M.", the counts sentence, the genres the next batch leans toward, a primary
  button that requests more artists through the existing generation hook (label "Load more
  artists", disabled with "Generating…" while running; on an unauthorised result, go to sign-in),
  and a secondary link to Saved. On phones it is the final snap page.
- **Empty feed (no recommendations yet):** the existing loader and Explore pre-warm are kept and
  restyled only through tokens.
- **Cold-start hint:** the existing banner component is kept and placed at the top of the queue
  column on desktop and as the first item above the first card on tablet. On phones it is shown as
  a dismissible line under the top bar.

### Snap behaviour details (phones)

- The feed area between the top bar and the triage bar is a vertical scroller with mandatory
  scroll snapping; each artist is one full-height page. The page body itself does not scroll.
- The artist whose page is at least 60% visible becomes the selected artist (intersection
  observer). The triage bar, progress strip and keyboard act on the selected artist.
- Card layout, top to bottom: artwork (square, sized
  `min(100cqw - 52px, 100cqh - 236px, 460px)` against the page's container so nothing scrolls
  inside the card at 375x667, 390x844 or 430x932; when height-limited the artwork sits on a mat of
  the artist's colour instead of being cropped) with a 64px play button and a 30-second progress
  ring; name; genres with save / open / share icon buttons (44px targets) on the same row; the why
  sentence; up to three equal-width track chips.
- Horizontal swipe on a card: right is "more like this", left is "less like this". Threshold 96px,
  or a fast flick past 40px. Past the threshold a tint and label fade in. Releasing short springs
  back. A committed card ignores further drags while it animates. Vertical scrolling must keep
  working over a card (`touch-action: pan-y`, drag direction lock).
- After a decision the scroller smooth-scrolls to the next undecided artist.
- Decided artists stay in the scroller: liked ones show a "Liked" badge on the artwork and a solid
  violet "More like this" button; passed and dismissed ones are dimmed with a badge
  ("Less like this" / "Dismissed"). Undo scrolls back to the artist.
- Scrolling past an artist records nothing.
- Entrance animations never start from opacity 0 (a throttled tab would show a see-through card).
- With reduced motion: no fling, no spring, instant scroll; the decision still applies.

### Landing page

- Fully static: the page must not read the session, cookies or headers. The proxy already redirects
  signed-in visitors from `/` to the feed, so the page's current signed-in branches are dead code
  and are removed along with the generation splash component that only they use. Verify with the
  build output that `/` is prerendered as static.
- Content, in order: top bar (wordmark, "Sign in" link, "Pick a name" button) · hero (headline
  "Somebody great you've never heard.", one supporting paragraph, primary button "Pick a name and
  start" to the new-account sign-in mode, and the playable card stack) · "Three moves, then it's
  all listening." with three steps illustrated by real interface fragments (a name field, the triage
  control with tuning chips, a mini queue) · "The sign-up form we didn't build" (email, password,
  birthday and streaming-account fields struck out, leaving Name) · closing call to action · footer.
  Copy is taken verbatim from the prototype.
- Hero card: artwork, play button, name, popularity label, the why line, the current track with a
  time readout, and "Less like this" / "More like this". Either button throws the card and shows
  the next sample artist; if a preview was playing, the next one plays. After the last sample it
  loops. No network requests other than artwork and audio.
- Phone order: headline, primary button, card, then the supporting paragraph; the play button must
  be fully visible at 375x667 and 390x844.
- The landing page wraps its card in the same audio provider the app uses.

### Accessibility and motion

- Every control is a real button or link with an accessible name; icon-only buttons have labels.
- Visible focus ring (2px, `--violet-ink`) on everything focusable.
- Touch targets are at least 44px; the three phone triage buttons are at least 56px tall.
- The shortcut sheet is a native dialog.
- Text contrast is at least 4.5:1 for body text and 3:1 for large text.
- Transitions are 150–250ms with `--ease`; only `transform` and `opacity` are animated.
- `prefers-reduced-motion` disables flings, springs, row exit animations and smooth scrolling.

### Performance

- No `backdrop-filter` on any scrolling content. No full-screen blend layers.
- Queue rows and snap pages use `content-visibility: auto` with an intrinsic size.
- The first artwork is loaded eagerly; all others lazily, with explicit dimensions.
- The landing page ships no code from the signed-in app beyond the audio provider and the hero card.

## Testing Decisions

A good test here checks behaviour through a module's public interface with plain inputs and
outputs, and would still pass after an internal rewrite. No tests of CSS, no snapshot tests of large
markup, no tests that assert on private state.

The test runner is Vitest in a Node environment (no browser DOM). Two existing patterns are the
prior art:

- Pure-logic tests next to the module (for example the feed-card assembler tests, the
  artist-signals tests, the explore-input tests).
- Server-render smoke tests that render a client component to a string and assert on text (the
  history client test).

Modules that get tests:

| Module | What is tested |
|---|---|
| Triage queue | Every function: ordering, wrap-around, "none left", liked stays visible, passed/dismissed leave, clamping at ends, empty list, unknown selected id |
| Feed keymap | Every binding; modifiers ignored; editable targets ignored; Space on a focused button ignored; help-open suppression |
| Artwork resolver | Image present; image null with album art; both null; empty tracks |
| Card copy helpers | One, two, three source artists; genres only; neither; popularity thresholds at boundaries; duration formatting |
| Landing sample | The shipped JSON passes the validator; the validator rejects a disallowed host and a missing preview |
| Feed triage hook's decision core | Extract the non-React part (what to do on judge/undo given state) as a pure function and test: advance only when judging the selected artist, keep-playing rule, un-like toggle, swipe-right on liked is a no-op, undo call per verdict |
| Shell and feed components | Server-render smoke tests: navigation shows all sections with the current one marked; feed renders the first artist's name, the three triage labels and "N of M left"; end-of-queue renders when everything is decided; an artist with no image renders the letter fallback |

Not unit-tested (covered by the manual checklist in the QA issue): scroll snapping, swipe gestures,
audio playback, focus order, safe-area insets, reduced motion.

Every issue must leave `npm run lint`, `npx tsc --noEmit` and `npm test` passing.

## Out of Scope

- The four parked directions (B-Side, Tuner, Atlas, Daily Drop) and any of their mechanics.
- The prototype's other phone views (Card, List, Queue) and the layout switcher.
- Layout redesigns of Explore, History, Saved, Stats, Settings, onboarding or sign-in.
- Any change to recommendation generation, Explore rail building, API routes, database schema,
  authentication, rate limiting, cron jobs or the Content-Security-Policy.
- The launch-scale findings from the 2026-11-09 audit (sign-in rate limit, preview and Last.fm
  throttling, polling volume, nightly clean-up, the 3.3 MB genre file). They need their own PRD.
  Two of that audit's front-end items are included here because the redesign requires them: the
  static landing page, and removing grain, blur and two font families.
- Swipe gestures on desktop, drag-to-reorder, playlists, social features.
- Auto-advance when a preview finishes playing.
- Replacing the avatar generator or the animation library to reduce bundle size.
- A user setting to choose between layouts.

## Further Notes

- **Real-device testing is required before release.** The prototype was only exercised with a mouse
  in an emulated phone viewport. Whether vertical snapping and horizontal swiping conflict on iOS
  Safari is the largest unknown. A human-in-the-loop QA issue covers it.
- **Artwork coverage.** Many production artists have no artist image; the resolver falls back to
  album art from the first preview track, which most feed cards have because cards without previews
  are already dropped. Existing issue #167 improves this at the source and is complementary.
- **Popularity thresholds** were chosen against mock data and may need tuning.
- **Estimated size** (from the prototype builders, not measured): about a week for one developer,
  plus device QA.
- **Wiki.** The pages-and-components wiki page must be updated by the issues that change behaviour,
  as the repository's agent rules require.

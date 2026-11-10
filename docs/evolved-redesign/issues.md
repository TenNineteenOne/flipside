# Evolved redesign: issue breakdown (draft)

> Draft for review. Each `## Issue` below becomes one issue on the tracker, published in this order
> so "Blocked by" can cite real issue numbers. `PRD` means the parent PRD issue.

## Dependency map

```
1 Foundation ──┬── 2 Landing ─────────────────────────────────────────┐
               └── 3 App shell ──┐                                     │
4 Triage logic ──────────────────┴── 5 Desktop feed core ──┬── 6 Desktop feed complete ──┬── 10 Snap complete ──┐
                                                           ├── 7 Keyboard                │                      │
                                                           ├── 8 Feed lifecycle ─────────┼──────────────────────┼── 12 Cleanup ── 13 Device QA (HITL)
                                                           └── 9 Snap core ──────────────┴── 11 Tablet + widths ┘
```

Issues 1 and 4 can start immediately and in parallel. All are AFK except 13.

## Text included at the top of every issue ("Working agreement")

```
## Working agreement (read first)

- Read the parent PRD in full before starting. Where this issue and the PRD disagree, the PRD wins.
- Branch from `Nick`. One issue = one branch = one pull request into `Nick`.
- This is Next.js 16. Read the relevant guide under `node_modules/next/dist/docs/` before writing
  code; APIs differ from older versions.
- The visual specification is the prototype on branch `design-lab`. To look at it:
  `git worktree add ../flipside-lab design-lab && cd ../flipside-lab && npm ci`, create `.env.local`
  containing only `AUTH_SECRET=design-lab-local-only-not-a-real-secret-0000`, then
  `npm run dev -- -p 3210` and open http://localhost:3210/lab/evolved and /lab/evolved/app.
  Read the prototype source with `git show design-lab:<path>`.
- Copy markup, class structure, CSS values and copy text from the prototype. Do NOT copy its data
  layer: it uses mock artists and local state. Use the production hooks named in the PRD.
- Never import from `lib/lab`, `components/lab` or `app/lab` in production code.
- No new dependencies. No changes to API routes, database, auth, cron or the security headers.
- Before opening the pull request, all three must pass: `npm run lint`, `npx tsc --noEmit`, `npm test`.
- If something in this issue cannot be done as written, stop and comment on the issue. Do not
  invent a different design.
```

---

## Issue 1: Foundation: new colour tokens, two font families, no grain or blur

**Type:** AFK · **Blocked by:** none · **User stories:** 59, 61

### What to build

Change the app's global look to the Evolved palette and typography without touching any page
layout. After this issue every existing page still works exactly as before but renders in the new
colours and fonts, with no film-grain overlay and no blurred cards.

### Steps

1. In the root layout, replace the four `next/font/google` families with two: Familjen Grotesk
   (variable weight, subsets `latin` and `latin-ext`, `display: "swap"`) and Martian Mono (weights
   400 and 500, same subsets). Expose them as the CSS variables the app already uses:
   `--font-sans` (Familjen Grotesk) and `--font-mono` (Martian Mono). Also set `--font-display` and
   `--font-serif` to Familjen Grotesk so existing `.display` and `.serif` markup keeps working.
2. In the global stylesheet:
   - Add the new tokens listed under "Design tokens" in the PRD to `:root`.
   - Re-point the existing tokens at them: `--bg-base` → `--bg`, `--bg-card` → `--panel`,
     `--bg-elevated` → `--raise`, `--border` → `--line`, `--border-strong` → `--line-strong`,
     `--text-primary` → `--fg`, `--text-secondary` → `--fg-2`, `--text-muted` → `--fg-3`.
     `--text-faint` becomes `--fg-3` too (the old value fails contrast). `--accent` stays `#8b5cf6`.
   - Delete the `body::after` grain rule and the `--grain-opacity` token.
   - Delete `--font-display-settings` and every `font-variation-settings` that uses it.
   - Change `.serif` to `font-style: normal`. Keep the class.
   - Remove every `backdrop-filter` / `-webkit-backdrop-filter` (cards, nav). Give the nav a solid
     `--rail` background instead.
   - Delete the `.aura` rule (the purple radial glow).
3. In the root layout, delete the inline `<style>` block that re-adds `backdrop-filter` to
   `.fs-card` and `.appnav`.
4. In the existing artist card component, remove the inline `backdropFilter` /
   `WebkitBackdropFilter` and set its background to the `--panel` token.
5. Update the `themeColor` in the root layout's viewport export to match `--bg` (use `#121015`).

### Acceptance criteria

- [ ] Only two font families are requested by the app (check the Network tab on `/` and `/feed`: no Fraunces, Instrument Serif, JetBrains Mono or Inter files).
- [ ] `grep -rn "backdrop-filter\|backdropFilter" app components` returns nothing outside `app/lab` and `components/lab`.
- [ ] `grep -n "body::after\|grain" app/globals.css` returns nothing.
- [ ] The landing page, sign-in, onboarding, feed, explore, history, saved, stats and settings pages all render without console errors and without unstyled or invisible text.
- [ ] No text uses a colour dimmer than `--fg-3` on `--bg`.
- [ ] No layout, spacing or behaviour change on any page beyond colours, fonts and the removed effects.
- [ ] `npm run lint`, `npx tsc --noEmit` and `npm test` pass.

### Do not

- Do not restyle or move any component. That is later issues.
- Do not rename existing CSS variables or classes; re-point them.

---

## Issue 2: Static landing page with a playable artist card

**Type:** AFK · **Blocked by:** Issue 1 · **User stories:** 1–9

### What to build

Replace the landing page with the Evolved landing: a static page whose hero is a real artist card a
visitor can play and triage without an account, followed by the three-step explainer and the
sign-up promise. See "Landing page" in the PRD.

### Prototype reference

`app/lab/evolved/page.tsx` (page structure and all copy), `components/lab/evolved/hero-stack.tsx`
(the card stack), `components/lab/evolved/shared.tsx` (wordmark, why text, popularity label), and
the landing rules in `app/lab/evolved/evolved.css` (classes for the hero, steps and form).

### Steps

1. **Sample data.** Create a production data file with six sample artists (use these six from the
   prototype's `lib/lab/artists.json`: Glass Beams, YĪN YĪN, Altın Gün, Mdou Moctar, Nala Sinephro,
   Kokoroko). Each entry: `id`, `name`, `genres`, `popularity`, `imageUrl`, `color`,
   `why: { sourceArtists, genres }`, `tracks: [{ id, name, previewUrl, durationMs }]` (1–3 tracks).
   Copy the regeneration script from the prototype (`scripts/lab-fetch-artists.mjs`) to a
   production script name, trimmed to these six, and add an `npm` script for it.
2. **Validator.** Write a pure `validateLandingSample(data)` that returns a list of problems: empty
   list, missing required field, an artist with no track, any URL whose host is not `*.mzstatic.com`
   (images) or `audio-ssl.itunes.apple.com` / `*.mzstatic.com` (audio). Add tests: the shipped file
   returns no problems; a disallowed host is reported; an artist with zero tracks is reported.
3. **Hero card stack** as a client component, ported from the prototype: artwork, play button,
   name, popularity label, why line, current track with a time readout ("0:12 of 3:21"), and
   "Less like this" / "More like this". Pressing either throws the card (transform + opacity,
   250ms) and shows the next sample; if a preview was playing, the next sample's first track
   plays. After the last sample, start again from the first. Use the existing audio provider and
   hook. If `play()` fails the existing provider already resets `isPlaying`; show the play icon again.
4. **Page.** Rewrite the landing page as a server component with **no** call to the auth helper,
   cookies or headers. Remove the signed-in branches and the generation splash component that only
   this page imported (delete the component file if nothing else imports it; confirm with a search).
   Wrap the hero in the audio provider. Port every section and all copy from the prototype. The
   primary buttons link to the sign-in page in new-account mode (`/sign-in?mode=new`); "Sign in"
   links to `/sign-in`.
5. **Styles.** Put the landing styles in their own stylesheet scoped under one root class, ported
   from the prototype. Phone order at widths under 640px: headline, primary button, card, then the
   supporting paragraph.
6. **Metadata.** Keep the existing title and description.

### Acceptance criteria

- [ ] `npm run build` lists `/` as static (prerendered), not dynamic.
- [ ] The landing page source contains no import of the auth helper.
- [ ] Signed out: pressing play on the hero card plays audio within one tap; the play button becomes pause; the time readout advances.
- [ ] "More like this" and "Less like this" each replace the card with the next sample; after six, it loops.
- [ ] If a preview is playing when a button is pressed, the next sample starts playing without another tap.
- [ ] Both primary buttons go to `/sign-in?mode=new`.
- [ ] At 375x667 and 390x844 the headline, primary button and the whole play button are visible without scrolling.
- [ ] No horizontal scroll at 375, 390, 768 or 1440 wide.
- [ ] A signed-in visitor to `/` is still redirected to the feed (this is the proxy's job; just confirm it still works).
- [ ] Validator tests pass; `npm run lint`, `npx tsc --noEmit`, `npm test` pass.

### Do not

- Do not fetch sample data at request time or from the database.
- Do not add analytics, cookies or any client storage.

---

## Issue 3: App shell: navigation rail, top bar, tab bar, avatar menu

**Type:** AFK · **Blocked by:** Issue 1 · **User stories:** 10–16, 61

### What to build

Replace the current top navigation on all signed-in pages with the Evolved shell. Desktop (900px and
wider): a left navigation rail. Below 900px: a slim top bar and a bottom tab bar. Page content is
unchanged in this issue.

### Prototype reference

`components/lab/evolved/discover.tsx` (the rail markup: wordmark, nav list, footer) and
`components/lab/evolved/mobile-shell.tsx` (top bar, avatar popover, tab bar), with their rules in
`app/lab/evolved/evolved.css` (`.ev-rail*`, `.ev-m-top*`, `.ev-m-tabs*`, `.ev-m-menu*`).

### Steps

1. Build the rail: wordmark at the top; links Feed, Explore, History, Saved, Stats, Settings with
   the same icons the current nav uses; the user's identicon and a "Shortcuts" hint at the bottom.
   Width 232px at 1100px and wider; 64px (icons only, with `title` and `aria-label`) at 900–1099px.
   Background `--rail`, right border `--line`. It is fixed to the viewport height and does not scroll
   with the page.
2. Build the top bar (below 900px): wordmark on the left; on the right an avatar button that opens
   a menu (native popover) with Settings and Sign out. Height 56px plus the top safe-area inset.
3. Build the tab bar (below 900px): Feed, Explore, History, Saved, Stats. 56px tall plus the bottom
   safe-area inset, fixed to the bottom, background `--rail`, top border `--line`. Each tab is a
   link with icon and label, minimum 44px target.
4. Current section: `aria-current="page"` and the highlighted style on the matching item (a path
   matches when it equals the link or starts with it plus `/`).
5. Keep the existing navigation-progress indicator on links, and keep prefetching for Explore.
6. Adventurous mode (existing hook, same initial value passed from the signed-in layout): show the
   existing four-colour gradient as a 2px line on the rail's right edge (desktop) or under the top
   bar (below 900px).
7. In the signed-in layout, replace the old nav with the shell. Page content is rendered in a
   scrolling main area to the right of the rail on desktop, and between the bars below 900px (pad
   the content by the bars' heights). Remove the old 520px column cap for the **feed route only if**
   that is needed for later issues; for all other pages keep their current content width, centred
   in the main area.
8. Delete the old nav component and its CSS once nothing imports it.
9. Add a server-render smoke test: the shell renders all six section names, marks the current one,
   and renders the tab bar with five items.

### Acceptance criteria

- [ ] At 1440px every signed-in page shows the rail with six links; the old top nav is gone.
- [ ] At 1000px the rail shows icons only and each icon has an accessible name.
- [ ] At 390px every signed-in page shows the top bar and a five-item tab bar; Settings and Sign out are reachable from the avatar menu.
- [ ] The current section is marked with `aria-current="page"` on every page.
- [ ] Content is never hidden under the tab bar or top bar (scroll each page to its end at 390px).
- [ ] Explore, History, Saved, Stats and Settings look and behave as before inside the shell.
- [ ] Keyboard: Tab reaches every nav link in order with a visible focus ring; the avatar menu opens with Enter and closes with Escape.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` pass.

### Do not

- Do not change the feed's content in this issue.
- Do not add a seventh tab on phones.

---

## Issue 4: Feed triage logic as pure, tested modules

**Type:** AFK · **Blocked by:** none · **User stories:** 22–28, 35–40, 60, 62

### What to build

The framework-free logic the new feed runs on, with tests and no user interface: the triage queue
functions, the feed keymap, the artwork resolver, the card copy helpers, and the decision core.
Interfaces are specified in the PRD under "Modules" 1–4; implement them exactly.

### Steps

1. **Triage queue**: implement `visibleQueue`, `remaining`, `counts`, `nextUndecided`, `step`,
   `firstUndecided` with the signatures in the PRD. A signal value of `thumbs_up` means liked,
   `thumbs_down` passed, `skip` dismissed; any other or missing value means undecided.
2. **Feed keymap**: implement `feedAction` with the signature and bindings in the PRD.
3. **Artwork resolver**: `artworkFor(artist)` per the PRD.
4. **Card copy helpers**: why sentence parts (return structured parts so the interface can bold the
   source-artist names: for example `{ lead: "Because you like ", names: ["A", "B"], genres: [] }`),
   `popularityLabel`, `formatDuration`.
5. **Decision core** (pure): given `{ ids, signals, selectedId, playingArtistId }` and a request
   `{ artistId, signal, toggle, advance }`, return a plan:

   ```ts
   type Plan = {
     /** What to send through the feedback hook. */
     send: { kind: "set"; signal: "thumbs_up" | "thumbs_down" | "skip" } | { kind: "none" }
     /** New selected artist id, or the unchanged one. */
     selectId: string | null
     /** Start this artist's first track, pause, or leave audio alone. */
     audio: { kind: "play"; artistId: string } | { kind: "pause" } | { kind: "none" }
     /** How to undo, or null when nothing was sent. */
     undo: { kind: "setThumbsUpAgain" | "removeSignal" | "dismiss"; artistId: string } | null
     /** Toast text. */
     message: string
   }
   ```

   Rules:
   - `thumbs_up` on an artist that is already `thumbs_up`: if `toggle` is true, send `thumbs_up`
     (the hook turns a repeat into a delete), do not change the selection, message
     "Removed like from {name}", undo null. If `toggle` is false (a swipe), send nothing and return
     an empty message.
   - Otherwise send the signal. If `advance` is true and `artistId === selectedId`, `selectId` is
     `nextUndecided` computed with the signal applied; else `selectId` is unchanged.
   - Audio: only when the selection advanced and `playingArtistId === artistId`: play the new
     selected artist, or pause when it is null. Otherwise none.
   - Undo: `thumbs_up` → `setThumbsUpAgain`; `thumbs_down` → `removeSignal`; `skip` → `dismiss`.
   - Messages: "More like {name}", "Less like {name}", "Dismissed {name}".
6. Tests for every function, covering at least the cases listed for these modules in the PRD's
   "Testing Decisions" table. Put each test file next to its module.

### Acceptance criteria

- [ ] All five modules exist with the specified signatures and have no React, DOM or network imports.
- [ ] Tests cover: empty list; all decided; wrap-around in `nextUndecided`; liked stays in `visibleQueue`; passed and dismissed leave it; `step` clamps at both ends and handles an unknown selected id; every key binding; modifier keys; editable target; Space on a button; help open; artwork fallback order; why sentence with 0, 1, 2 and 3 source artists; popularity thresholds at 34/35, 44/45, 51/52; duration `0:05`, `3:21`; every decision-core rule above.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` pass.

### Do not

- Do not build any component in this issue.

---

## Issue 5: Desktop feed core: queue, focus pane, play, and the three decisions

**Type:** AFK · **Blocked by:** Issue 3, Issue 4 · **User stories:** 17–23, 25, 26, 28

### What to build

The first working version of the new feed at 900px and wider: a queue of artists in the centre and a
focus pane on the right for the selected artist, with play and the three decisions wired to the real
feedback API, and auto-advance. Below 900px the feed keeps rendering its current card list for now
(later issues replace it).

### Prototype reference

`components/lab/evolved/discover.tsx`: the desktop render (queue column, focus pane, triage
control) and the `judge` / `togglePlay` / `playArtist` logic. CSS: `.ev-app`, `.ev-queue*`,
`.ev-row*`, `.ev-focus*`, `.ev-triage*`, `.ev-strip*` in `app/lab/evolved/evolved.css`.

### Steps

1. **Feed triage hook.** Create the hook described in the PRD ("Feed triage hook"). Inputs: the
   list of card artists and the user's music platform. It uses the existing artist-feedback hook
   (with the same error messages the current feed passes), the existing artist-saves hook, and the
   audio hook. It holds `selectedId` in state (initially `firstUndecided`). `judge` calls the
   decision core from Issue 4 and executes its plan: call `setSignal`, set the selection, play or
   pause. Toasts and undo are added in Issue 6; for now expose `lastPlan` only.
2. **Feed client.** Keep everything the current feed client does with data: the recommendation
   list state, the background fill hook and its append logic, the low-queue top-up effect, the
   generation guard and its release on unmount. Replace only what it renders. At 900px and wider
   render the new layout; below 900px render the existing card list unchanged (use a CSS media
   query to switch, rendering both trees is not acceptable: pick with a `matchMedia` subscription
   via `useSyncExternalStore`, server default = desktop off, exactly as the prototype does with its
   `wide` flag).
3. **Queue column.** Header "Today's flipside", the sentence "{M} artists you've never played,
   picked from what you told us.", "N of M left" and the segmented progress strip. Then one row per
   artist in `visibleQueue` order: 48px artwork thumbnail (via the artwork resolver; letter fallback
   when null), name, why line, first genre (only at 1280px and wider), and a "Liked" tag when liked.
   Clicking a row selects it. The selected row has the highlighted style and `aria-current="true"`.
   The list scrolls inside its column.
4. **Focus pane.** For the selected artist: large square artwork tinted with the artist colour
   (`--a`), name, genres, the why sentence with source artists bold, the popularity meter and
   label, a primary "Play preview" button (toggles to "Pause"), and the triage control: three
   buttons "Less like this", "Dismiss", "More like this" (the last in the violet style; solid violet
   with the label "Liked" when the artist is liked).
5. **Play.** Play/pause uses the existing audio hook with the artist's first track. If the artist
   has no tracks yet, use the existing artist-tracks hook as the current card does, and disable the
   button with "Loading tracks…" until they arrive, or "No preview available" if none do.
6. **Decide.** Each triage button calls `judge(selected.id, signal, { toggle: true, advance: true })`.
7. Remove the feed's old page header and ambient background at 900px and wider.
8. Server-render smoke test for the feed client with three artists: the first artist's name
   appears, the three triage labels appear, "3 of 3 left" appears.

### Acceptance criteria

- [ ] At 1440px `/feed` shows rail, queue and focus pane; the queue lists the same artists, in the same order, that the old feed showed.
- [ ] Clicking a queue row shows that artist in the focus pane.
- [ ] "Play preview" plays the selected artist's first track; pressing again pauses.
- [ ] "More like this" sends `thumbs_up`, marks the row "Liked", keeps it in the queue, and selects the next undecided artist.
- [ ] "Less like this" sends `thumbs_down` and "Dismiss" sends `skip` (check the Network tab: one POST to the feedback route each); the row leaves the queue and the next undecided artist is selected.
- [ ] If a preview is playing when a decision is made, the next artist's preview starts.
- [ ] "N of M left" and the progress strip update after every decision.
- [ ] Reloading the page shows the decisions persisted (decided artists are gone or liked, as the server returns them).
- [ ] Below 900px `/feed` still shows the old card list and works.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` pass.

### Do not

- Do not keep a separate verdict state; read verdicts from the feedback hook's `signals` map.
- Do not change the feed page's server component or any data loading.

---

## Issue 6: Desktop feed complete: undo, secondary actions, tracks, docked player, tuning

**Type:** AFK · **Blocked by:** Issue 5 · **User stories:** 24, 27, 29–31

### What to build

Everything else the desktop focus pane and rail need: the five-second Undo toast, un-like, save /
open / share, the three-track list, the docked player, the tuning summary, and the row exit
animation.

### Prototype reference

Same files as Issue 5: the toast (`.ev-toast*`), track list (`.ev-tracks*`), secondary actions
(`.ev-actions*`), docked player (`.ev-player*`), rail tuning block (`.ev-tuning*`).

### Steps

1. **Undo toast.** After every `judge`, show a toast through the existing toast system with the
   plan's message and an "Undo" action when `plan.undo` is not null; duration 5000ms. Undo performs
   the call named in the plan (`setSignal(id, "thumbs_up")`, `removeSignal(id)` or `dismiss(id)`)
   and reselects that artist. A new decision replaces the previous toast.
2. **Un-like.** Pressing the solid "Liked" button un-likes in place (decision core, `toggle: true`).
3. **Secondary actions** as icon buttons with text labels in the focus pane: Save (toggles; uses
   the saves hook; toast "Saved {name}" / "Removed {name} from Saved"), Open in {platform} (existing
   artist-link helper and platform icon and label; opens in a new tab with `rel="noopener noreferrer"`),
   Share (existing shareable-link helper; `navigator.share` when available, else copy and toast
   "Link to {name} copied"; a dismissed share sheet is not an error).
4. **Track list.** Up to three rows: number, track name, album name, duration (`formatDuration`),
   play/pause per row. The playing row is highlighted and shows progress.
5. **Docked player.** Add a `docked` variant to the existing mini player: it sits at the bottom of
   the focus pane (not floating), shows artwork thumbnail, track and artist name, play/pause and a
   progress bar; when nothing is playing it shows "Nothing playing. Press Space to hear the selected
   artist." The floating variant is unchanged and is used below 900px.
6. **Saved count.** The Saved item in the rail shows a count badge of artists saved during this
   session (from the saves hook's set size minus its initial size; hide at zero).
7. **Tuning.** In the rail, under the nav: "Leaning toward" with up to six genre chips from liked
   artists and "Leaning away" with up to four from passed artists, from the hook's `tuning` value.
   Hidden when both are empty and at rail widths below 1100px.
8. **Row exit.** A passed or dismissed row fades and collapses over 200ms before leaving the list
   (opacity + transform; the list may then close up instantly). With reduced motion it leaves
   immediately.

### Acceptance criteria

- [ ] Each decision shows a toast with the right text and an Undo button for five seconds.
- [ ] Undo after "More like this" removes the like; after "Less like this" and after "Dismiss" the artist returns to the queue and is selected (check one DELETE request each).
- [ ] Pressing "Liked" un-likes without changing the selection.
- [ ] Save toggles, persists across reload, and the Saved badge counts session saves.
- [ ] "Open in …" uses the user's preferred platform name and icon and opens the right URL in a new tab.
- [ ] Share copies a link (or opens the share sheet) and never throws when the sheet is dismissed.
- [ ] Each of the three track rows plays its own preview; only one plays at a time.
- [ ] The docked player reflects playback and its play/pause works; the floating mini player does not also appear on desktop.
- [ ] Tuning chips appear after the first like or pass and update with each decision.
- [ ] With `prefers-reduced-motion: reduce`, rows leave without animation.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` pass.

---

## Issue 7: Keyboard shortcuts, key hints and the shortcut sheet

**Type:** AFK · **Blocked by:** Issue 5 · **User stories:** 35–41

### What to build

Full keyboard control of the desktop feed using the keymap from Issue 4, visible key hints, and a
"?" sheet listing the shortcuts.

### Prototype reference

`components/lab/evolved/discover.tsx`: the `keydown` effect and the `<dialog>` sheet;
`shared.tsx` `Kbd`; CSS `.ev-kbd`, `.ev-keys*`, `.ev-sheet*`.

### Steps

1. One `keydown` listener on `window`, registered by the feed client while mounted. Build the
   keymap input from the event (`targetIsEditable` = the target is or is inside `input`, `textarea`,
   `select` or `[contenteditable]`; `targetIsButtonOrLink` = the target's tag is `BUTTON` or `A`).
   Guard against a non-element target (use `document.body`).
2. Dispatch: `next`/`prev` → `move(±1)` and scroll the newly selected row into view with
   `block: "nearest"`; `togglePlay`; `track1..3` → `playTrack(selected, n)`; `more`/`less`/`dismiss`
   → `judge`; `save`; `open` (`window.open(url, "_blank", "noopener")`); `share`; `undo` (same as
   the toast's Undo; no-op when nothing to undo); `toggleHelp`. Call `preventDefault()` for `next`,
   `prev`, `togglePlay` and `toggleHelp`.
3. Key hints: a small row under the triage control ("X less · D dismiss · L more · B save · O open ·
   J K move") and a "Space" keycap on the play button. Hidden on touch devices and below 900px
   (`@media (hover: none), (max-width: 899px)`).
4. Shortcut sheet: a native `<dialog>` opened with `showModal()`, listing every binding in two
   columns, closed with Escape, the close button or "?". Also reachable from the rail's "Shortcuts"
   item.

### Acceptance criteria

- [ ] Every binding in the PRD works on `/feed` at 1440px.
- [ ] Typing in any input (for example on Settings, or a search field) triggers no shortcut.
- [ ] Space on a focused button presses that button once and does not also toggle playback.
- [ ] Holding Cmd, Ctrl or Alt with a bound key does nothing (browser shortcuts still work).
- [ ] "?" opens the sheet; while it is open no other shortcut fires; Escape closes it and focus returns to the page.
- [ ] Moving with J/K keeps the selected row visible in the queue.
- [ ] Key hints are not rendered visibly at 390px.
- [ ] The listener is removed when leaving the feed (shortcuts do nothing on other pages).
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` pass.

---

## Issue 8: Feed lifecycle: end of queue, loading more, background appends, cold start, missing artwork

**Type:** AFK · **Blocked by:** Issue 5 · **User stories:** 32–34, 60

### What to build

The states around the main loop on desktop: what happens when the queue runs out, when more
artists arrive, when the user is new, and when an artist has no image.

### Prototype reference

`components/lab/evolved/discover.tsx`: `endState`; CSS `.ev-end*`.

### Steps

1. **End of queue.** When `remaining` is 0, the focus pane shows the end state: up to four liked
   artworks, "You've heard all {M}.", "{liked} liked, {passed} less like this, {dismissed}
   dismissed.", "Tomorrow's batch leans toward {genre} and {genre}." (from `tuning.more`, omitted
   when empty), a primary button "Load more artists" and a secondary link "Review saved" to Saved.
2. **Load more.** The button calls the existing generation hook's request-more function, exactly
   as today's "Load more artists" button does: disabled with "Generating…" while running; on an
   unauthorised result go to the sign-in page; on success restart the background fill and refresh
   the route. When new artists arrive, select the first undecided one.
3. **Background appends.** Confirm that appended artists appear at the end of the queue, increase
   M, add segments to the strip, and never change the selection or scroll position. If the
   selection is null (end state showing) when artists arrive, select the first undecided one.
4. **Cold-start hint.** Render the existing banner component at the top of the queue column,
   unchanged in logic.
5. **Empty feed.** No change in logic: the existing loader and Explore pre-warm still render when
   the server has no recommendations. Check it looks correct inside the new shell.
6. **Missing artwork.** Everywhere artwork is shown (row thumbnail, focus pane, end state), use
   the artwork resolver; when it returns null render a square in the artist colour with the first
   letter of the name, `aria-hidden`, and keep the artist name as text nearby.
7. **Loading skeleton.** Update the feed route's loading file to a skeleton of the new layout
   (rail is already there; queue rows and focus pane as shimmer blocks) using the existing
   skeleton class.
8. Smoke tests: end state renders when all artists are decided; an artist with null image and no
   tracks renders the letter fallback.

### Acceptance criteria

- [ ] Deciding the last artist shows the end state with correct counts.
- [ ] "Load more artists" shows "Generating…", then new artists appear and the first is selected.
- [ ] While triaging, artists appended in the background do not move the selection or scroll.
- [ ] A new account still sees the cold-start hint.
- [ ] An account with no recommendations still sees the loader and then the feed.
- [ ] No broken-image icon appears for any artist; artists without images show the letter panel.
- [ ] The loading skeleton matches the new layout and causes no layout shift when content arrives.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` pass.

---

## Issue 9: Phone Snap feed core: one artist per screen, snap scrolling, triage bar

**Type:** AFK · **Blocked by:** Issue 5 · **User stories:** 42–44, 48–50, 52, 55

### What to build

Replace the old card list below 640px with the Snap feed: a vertical scroller where each artist is
one full-height page, the artist in view is the selected one, and a fixed three-button triage bar
above the tab bar records decisions through the same feed triage hook as desktop.

### Prototype reference

`components/lab/evolved/mobile-shell.tsx`: the `snap` view (scroller, intersection observer,
snap card, triage bar, top bar count and strip). CSS: `.ev-m-*` rules, especially `.ev-m-snap*`,
`.ev-m-card*`, `.ev-m-triage*`. Open the prototype at `/lab/evolved/app?view=snap` at 390px wide.
Ignore the prototype's "Layout" switcher row and its `card`, `list` and `queue` views.

### Steps

1. **Layout** (below 640px): a fixed column of height `100dvh`: top bar (from Issue 3) now also
   showing "N of M left" and the progress strip; the snap scroller filling the space; the triage
   bar; the tab bar (from Issue 3). The page body does not scroll on this route at this width.
2. **Scroller.** `overflow-y: auto`, `scroll-snap-type: y mandatory`, `overscroll-behavior: contain`.
   Each artist page: `height: 100%`, `scroll-snap-align: start`, `scroll-snap-stop: always`,
   `container-type: size`. All artists in the list are rendered (decided ones included), in order.
3. **Selected in view.** An intersection observer (root = the scroller, threshold 0.6) calls the
   hook's `becomeCurrent(id)` for the page that crosses the threshold. `becomeCurrent` selects the
   artist; playback hand-over is Issue 10.
4. **Snap card** per the PRD ("Snap behaviour details", card layout): artwork sized with the
   `min()` formula on a colour mat, 64px play button with a progress ring on the artwork, name,
   genres row with save / open / share icon buttons (44px, labelled), why sentence, up to three
   track chips (tapping a chip plays that track). Uses the artwork resolver and copy helpers.
5. **Triage bar.** Three buttons at least 56px tall, icon above label: "Less like this", "Dismiss",
   "More like this" (violet style; solid violet when the selected artist is liked). They call
   `judge(selected.id, signal, { toggle: true, advance: true })`.
6. **Advance.** When the selection changes because of a decision, scroll the scroller to the newly
   selected artist's page (`scrollTo` with `behavior: "smooth"`; `"auto"` under reduced motion).
   Guard against a feedback loop: while a programmatic scroll is in progress, ignore observer
   callbacks for other pages.
7. The first card's artwork loads eagerly; others lazily. Pages use `content-visibility: auto`
   with `contain-intrinsic-size`.
8. Entrance animation, if any, must not start from opacity 0.

### Acceptance criteria

- [ ] At 390x844 `/feed` shows one artist per screen; scrolling moves exactly one artist at a time and snaps.
- [ ] The count and strip in the top bar reflect the artist in view and the decisions made.
- [ ] Each triage button records the right signal for the artist in view (one POST each) and the feed scrolls to the next undecided artist.
- [ ] Scrolling past artists without deciding sends nothing.
- [ ] The play button on the artwork plays and pauses; the ring fills as the preview plays.
- [ ] Nothing inside a card scrolls or is cut off at 375x667, 390x844 or 430x932.
- [ ] No horizontal scroll at 375, 390 or 430 wide.
- [ ] The tab bar and triage bar respect `env(safe-area-inset-bottom)`.
- [ ] At 900px and wider the desktop feed is unchanged.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` pass.

### Do not

- Do not port the layout switcher or the other three phone views.
- Do not duplicate decision logic; everything goes through the feed triage hook.

---

## Issue 10: Phone Snap complete: swipe, verdict badges, undo, playback hand-over, end page

**Type:** AFK · **Blocked by:** Issue 6, Issue 9 · **User stories:** 45–47, 49, 51, 53, 54, 58

### What to build

The rest of the Snap experience: horizontal swipe to decide, visible verdicts on decided cards, the
Undo toast in the right place, audio that follows the card in view, the conditional mini player, and
the end-of-queue page.

### Prototype reference

`components/lab/evolved/mobile-shell.tsx`: the draggable card (`useMotionValue`, `useTransform`,
`onDragEnd`, the `committed` guard), verdict overlays (`.ev-m-verdict*`), badges, mini player rule,
end page. Prototype URL `/lab/evolved/app?view=snap` and `?view=snap&demo=swipe`.

### Steps

1. **Swipe.** Make the snap card horizontally draggable with the existing animation library:
   `drag="x"`, `dragDirectionLock`, `dragSnapToOrigin`, `touch-action: pan-y` on the card. Rotation
   follows the drag (`[-240, 240]` → `[-7deg, 7deg]`). On release: if the offset is beyond ±96px, or
   beyond ±40px with velocity beyond ±500px/s, commit: right → `judge(id, "thumbs_up",
   { toggle: false, advance: true })`, left → `judge(id, "thumbs_down", { toggle: false, advance:
   true })`. Otherwise spring back. While a commit animation runs, ignore further drags on that card.
   There is no swipe for Dismiss.
2. **Swipe labels.** While dragging right, a violet tint and a "More like this" label fade in from
   24px to 96px of offset; left, a dark tint and "Less like this".
3. **Verdict on decided cards.** Liked: a "Liked" badge on the artwork. Passed/dismissed: the card
   is dimmed (not hidden) with a "Less like this" / "Dismissed" badge. Decided cards remain
   scrollable, playable and re-decidable.
4. **Undo.** The toast from Issue 6 appears above the triage bar on phones (offset it by the
   combined height of the triage bar and tab bar plus the bottom safe area). Undo also scrolls back
   to that artist.
5. **Playback hand-over.** In `becomeCurrent(id)`: if audio is playing and the playing track does
   not belong to this artist, start this artist's first track. If nothing is playing, do nothing.
6. **Mini player.** Below 900px show the floating mini player only when something is playing (or
   paused mid-track) and it belongs to an artist other than the one in view. It sits above the
   triage bar.
7. **End page.** After the last artist, a final snap page with the end-of-queue content from
   Issue 8 (same component). The triage bar is hidden while the end page is in view.
8. **Reduced motion.** No rotation, no fling, no spring: a release past the threshold commits
   immediately and the card returns to rest; scrolling is instant.

### Acceptance criteria

- [ ] Swiping a card right past the threshold records `thumbs_up` and scrolls to the next undecided artist; swiping left records `thumbs_down`.
- [ ] A short swipe springs back and sends nothing.
- [ ] Swiping right on an already-liked artist sends nothing and does not un-like.
- [ ] Vertical scrolling still works when the gesture starts on a card.
- [ ] Decided artists remain in the scroll with the correct badge after scrolling away and back.
- [ ] The Undo toast never overlaps the triage bar; Undo restores the artist and scrolls to it.
- [ ] With a preview playing, scrolling to another artist switches audio to that artist; with nothing playing, scrolling starts no audio.
- [ ] The mini player appears only when the playing artist is not the one in view.
- [ ] The end page appears after the last artist and "Load more artists" works from it.
- [ ] With reduced motion enabled, decisions apply with no fling or spring.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` pass.

---

## Issue 11: Tablet layout and in-between desktop widths

**Type:** AFK · **Blocked by:** Issue 6, Issue 9 · **User stories:** 56

### What to build

The 640–899px layout (single-artist card beside a vertical "Up next" list) and the two reduced
desktop layouts (900–1099px and 1100–1279px).

### Prototype reference

`components/lab/evolved/mobile-shell.tsx` (the `card` view's tablet branch and the vertical list)
and the `@media` blocks in `app/lab/evolved/evolved.css` at 1279px, 1099px and 640–899px. View the
prototype at 768x1024.

### Steps

1. **640–899px.** Top bar with count and strip; a two-column area: left, one snap card (the same
   component as phones, not in a scroller) for the selected artist with the triage bar under it
   capped at 528px wide; right, a 280px vertical "Up next" list: rows with thumbnail, name, first
   genre and verdict mark (heart badge when liked; dimmed with an X when passed or dismissed), the
   selected row highlighted; tapping a row selects it. The list scrolls on its own. Tab bar at the
   bottom. Swipe on the card works as on phones.
2. **900–1099px.** Rail is icon-only (already built in Issue 3). Queue and focus pane share the
   remaining width; the tuning block is hidden; the docked player gets enough bottom padding to
   clear nothing (no overlap with any fixed element).
3. **1100–1279px.** Full rail; the genre column in queue rows is hidden.
4. Resizing the window across any breakpoint keeps the selected artist, decisions, saves and
   playback (all state lives in the feed triage hook, above the layouts).

### Acceptance criteria

- [ ] At 768x1024 the feed shows the card beside the Up next list; nothing looks like a stretched phone.
- [ ] Tapping an Up next row selects that artist; decided rows show the right mark.
- [ ] At 1000px and 1200px there is no overlap, clipping or horizontal scroll.
- [ ] Dragging the window from 1440px down to 375px and back keeps the same selected artist and decisions, and audio keeps playing.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` pass.

---

## Issue 12: Clean-up, Explore card restyle, performance and accessibility sweep, wiki

**Type:** AFK · **Blocked by:** Issue 2, Issue 7, Issue 8, Issue 10, Issue 11 · **User stories:** 57, 59, 61

### What to build

Remove what the redesign made dead, make Explore's existing card sit comfortably in the new look,
and verify performance and accessibility across the new surfaces. Update the wiki.

### Steps

1. **Dead code.** Remove the old feed rendering path (the under-900px fallback kept in Issue 5),
   the ambient background component if nothing imports it, unused CSS classes in the global
   stylesheet (`.appnav*`, `.page-head*` if unused, `.aura`), and unused font variables. Confirm
   each removal with a repository search before deleting.
2. **Explore's card.** The existing artist card stays, used only by Explore. Give it the `--panel`
   background, `--line` border, a 16px radius, no blur, a lighter shadow (`0 12px 30px
   rgba(0,0,0,0.35)`), and remove the `mix-blend-mode` tint overlay (use a plain gradient). Keep
   its buttons and behaviour exactly as they are.
3. **Performance.** Confirm `content-visibility: auto` on queue rows and snap pages; first artwork
   eager, others lazy with dimensions; no `backdrop-filter` and no fixed blend layers anywhere
   (repository search); no layout-property animations (search the new styles for transitions on
   `height`, `width`, `top`, `left`, `margin`, `padding`).
4. **Accessibility.** For landing, shell, desktop feed, Snap and tablet: every interactive element
   is a button or link with an accessible name; focus is visible; tab order follows the visual
   order; the shortcut sheet and avatar menu trap and return focus correctly; contrast of all new
   text is at least 4.5:1 (3:1 for 24px and larger). Fix what fails.
5. **Reduced motion.** With the setting on, walk through landing, desktop feed and Snap and
   confirm no flings, springs, row animations or smooth scrolls remain.
6. **Wiki.** Update the pages-and-components wiki page: the Screens table rows for the landing
   page and Feed, the Shared components list (new shell, queue, focus pane, snap card, triage
   control, docked player; the legacy card is now Explore-only), the hooks table (feed triage
   hook), and its `updated:` date. Add a short note to the architecture overview if it mentions
   the old nav.
7. **Lab leftovers.** Confirm nothing in production imports from `lib/lab`, `components/lab` or
   `app/lab`, and that `allowedDevOrigins` is not present in the Next config on this branch.

### Acceptance criteria

- [ ] `grep -rn "from \"@/lib/lab\|from \"@/components/lab" app components lib` returns nothing outside the lab folders (or the lab folders do not exist on this branch).
- [ ] Repository search finds no `backdrop-filter`, no `mix-blend-mode` on full-viewport elements, and no unused nav CSS.
- [ ] Explore renders its rails and cards with the new look and all its existing actions work.
- [ ] Keyboard-only walkthrough of landing → sign-in → feed → each nav section succeeds with visible focus throughout.
- [ ] Wiki pages updated with today's date.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` and `npm run build` pass.

---

## Issue 13: Real-device QA and design sign-off [HITL]

**Type:** HITL · **Blocked by:** Issue 12 · **User stories:** all

### What to build

Nothing is built. A person tests the finished redesign on real hardware and signs it off, filing
follow-up issues for anything found. This exists because the prototype was only ever exercised with
a mouse in an emulated phone viewport.

### Checklist

iPhone, Safari (required) and one Android phone, Chrome (required):

- [ ] Landing: first screen shows headline, button and play button; audio starts on first tap; both triage buttons advance the sample card.
- [ ] Sign up with a new name, complete onboarding, arrive at the feed.
- [ ] Snap: vertical scroll snaps one artist at a time; no rubber-band scrolling of the whole page.
- [ ] Snap: horizontal swipe decides without triggering the browser's back gesture (start swipes away from the screen edge and at the edge; note what happens).
- [ ] Snap: a diagonal drag does not both scroll and swipe.
- [ ] Snap: triage bar and tab bar sit above the home indicator; top bar clears the notch.
- [ ] Snap: audio continues across decisions; switching artists hands audio over; locking the phone and returning does not leave a stuck "playing" state.
- [ ] Snap: Undo toast is readable and tappable and does not cover the triage bar.
- [ ] Rotate to landscape and back: layout recovers.
- [ ] Add to Home Screen (iOS): opens without browser chrome and bars respect safe areas.
- [ ] Scrolling 20 artists feels smooth (no visible stutter).

Tablet (iPad or equivalent): card + Up next list at portrait; desktop layout at landscape.

Desktop (Chrome, Safari, Firefox): all keyboard shortcuts; resize across every breakpoint; docked
player; end of queue and "Load more artists".

Design sign-off by the owner: compare each surface with the prototype at the same width and list
differences that matter.

### Acceptance criteria

- [ ] Checklist completed on at least one iPhone and one Android phone, with results commented on this issue.
- [ ] Every failure has its own follow-up issue linked here.
- [ ] Owner has written "signed off" or listed blocking changes.

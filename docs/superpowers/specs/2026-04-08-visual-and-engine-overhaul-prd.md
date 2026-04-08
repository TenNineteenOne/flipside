# PRD: Flipside Visual & Recommendation Engine Overhaul

**Date:** 2026-04-08
**Status:** Approved
**Design Spec:** `docs/superpowers/specs/2026-04-08-visual-overhaul-design.md`

---

## Problem Statement

Flipside's current UI looks like a generic SaaS dashboard. The deep-navy background, teal accent, and plain card grid don't communicate "this is a music product." Users who land on the feed don't immediately feel the mood or excitement of discovering new artists.

At the same time, the recommendation engine has several silent failures that undermine the app's core promise:

1. **The play-threshold setting exists in the UI but is hardcoded to 0 in the API route** — the user's configured value is never read.
2. **Last.fm username is collected in Settings but is never used** — the listened-artists table populated from Last.fm lacks Spotify IDs, so the engine can't use those rows to filter out already-heard artists.
3. **Mainstream artists dominate recommendations** — there is no effective popularity tier weighting, so well-known names crowd out underground discoveries.
4. **Track data is fetched on-demand per artist, per user** — opening a drawer triggers a fresh Spotify API call every time, wasting rate-limit budget and causing visible loading delays.
5. **Groups code is still live** — routes, database writes, and nav links for the removed Groups feature remain in the codebase, creating confusion and dead code.

---

## Solution

This PRD covers two parallel tracks delivered together:

**Track 1 — Visual Overhaul:** Rebuild the Feed, Artist Detail Drawer, Saved, and Nav components using the approved A+C design direction: full-bleed hero images, Space Grotesk display type, per-artist dynamic accent colours, a prominent tap-to-expand track strip, and a slide-up drawer that reveals the full top-5 track list. The entire card is tappable.

**Track 2 — Recommendation Engine Overhaul:** Wire Last.fm scrobble history into the already-heard filter, enforce the user's play-threshold setting, introduce a three-tier popularity weighting that heavily favours underground artists (popularity 0–30), store extracted artist colours and pre-warmed track lists in the global cache tables to cut Spotify API calls to near-zero on page load, and delete all Groups-related code.

---

## User Stories

### Feed & Card

1. As a user, I want the feed to show artist cards with a full-bleed hero image so that the feed immediately feels like a premium music product rather than a generic list.
2. As a user, I want the artist's name displayed in a bold display typeface (Space Grotesk 700) overlaid on the hero image so that the name reads as the centrepiece of the card.
3. As a user, I want a genre tag displayed in the artist's dynamic accent colour directly above the artist name so that I can quickly scan genre context without it dominating the layout.
4. As a user, I want a short "reason text" beneath the hero image explaining why this artist was recommended so that I can understand the connection to music I already love.
5. As a user, I want genre pill chips displayed below the reason text so that I can see the artist's genre taxonomy at a glance.
6. As a user, I want a track strip on every card showing three stacked album art thumbnails, the featured track name, a "+ N more tracks" count, and a circular play button tinted to the artist's colour so that I'm invited to explore tracks without leaving the feed.
7. As a user, I want the entire card — hero image, body text, and track strip — to be a single tap target so that there is no ambiguity about how to open the artist drawer.
8. As a user, I want a "Not for me 👎" ghost button and a "+ Save" filled button at the bottom of each card so that I can quickly act on a recommendation.
9. As a user, I want the Save button to use the artist's dynamic accent colour so that the action feels contextual to the artist.
10. As a user, I want the "Not for me" action to animate the card to collapse into a slim bar showing the artist name, "Not for me" label, and an Undo button so that the decision feels reversible.
11. As a user, I want the "Not for me" state to reset when I refresh the browser so that transient dismissals don't persist between sessions.
12. As a user, I want tapping "Undo" on a collapsed "Not for me" card to restore the card to its full expanded state with a smooth animation so that I can reconsider easily.

### Artist Detail Drawer

13. As a user, I want tapping a card or its track strip to slide up an Artist Detail Drawer from the bottom of the screen so that I can see the full track list without navigating away.
14. As a user, I want the drawer to slide up with an expressive spring animation so that the interaction feels polished and alive.
15. As a user, I want the artist's hero card image to remain partially visible above the drawer's top edge (dimmed) so that I keep spatial context while the drawer is open.
16. As a user, I want a drag handle at the top of the drawer so that I know I can swipe it down to dismiss.
17. As a user, I want to be able to dismiss the drawer by swiping it down, tapping the backdrop scrim, or tapping an × button so that dismissal always feels within reach.
18. As a user, I want the drawer header to show the artist name, listener count, and a "+ Save artist" button tinted to the artist's colour so that I can save without scrolling.
19. As a user, I want the full reason text and genre pills in the drawer so that the context that appeared on the card is also available when I'm reading more deeply.
20. As a user, I want a "TOP TRACKS" section listing the top 5 tracks by default, with the currently playing track highlighted so that I can see what's playing.
21. As a user, I want a "Show more" option that expands the track list from 5 to 10 tracks so that power users can explore deeper.
22. As a user, I want each track row to show a track number, 30×30 album art, track name, duration, and a play button so that each track has sufficient context.
23. As a user, I want the first (or playing) track row to have a slightly elevated background and the artist's accent colour on the play button so that the active track stands out.
24. As a user, I want idle track rows to use muted grey text and a neutral play button so that unplayed tracks don't compete visually with the playing row.
25. As a user, I want the drawer footer to show an "Open in Spotify" link and a "Not for me" option so that I can deep-link to Spotify or dismiss the artist.
26. As a user, I want the drawer to close simultaneously as the underlying card collapses when I tap "Not for me" from within the drawer so that both transitions happen as one unified animation.

### Mini Player

27. As a user, I want the existing mini player to inherit the new dark base colours so that it blends with the redesigned UI.
28. As a user, I want the currently-playing artist's dynamic colour applied to the mini player's progress bar and track thumbnail border so that the player feels connected to the artist.
29. As a user, I want the mini player play/pause button to use the brand purple (`#8b5cf6`) so that the primary action is always clearly identifiable.

### Navigation

30. As a user, I want the bottom tab bar on mobile to show exactly three items — Feed, Saved, Settings — with no Groups item so that the nav is uncluttered and reflects the actual feature set.
31. As a user, I want the desktop top nav to show the Flipside logo on the left and the same three links right-aligned so that desktop navigation is consistent.
32. As a user, I want the active nav item to use the brand purple accent so that my current location is obvious.
33. As a user, I want the nav to use a frosted-glass blur background so that it feels layered and premium.

### Saved Screen

34. As a user, I want the Saved screen to default to an "Artists" tab showing a dense list of saved artists so that my collection is easy to browse.
35. As a user, I want each saved artist row to show a 46×46 artist photo, the artist name in Space Grotesk, genre tags, and a compact track strip so that the list is rich without being overwhelming.
36. As a user, I want the compact track strip in the Saved list to use the same artist dynamic colour as the feed so that the visual system is consistent.
37. As a user, I want a "Tracks" tab showing individually saved tracks in a minimal list row layout so that I can access my favourite tracks separately.
38. As a user, I want the Saved Artists tab to show an empty state with a nudge to enable Last.fm if the user hasn't connected their Last.fm account so that the discovery experience is more complete.

### Per-Artist Dynamic Colour

39. As a user, I want every artist card and drawer to display an accent colour derived from the artist's Spotify image so that each artist feels visually distinct.
40. As a user, I want the colour to be applied to exactly four elements — genre tag text, track strip background tint and border, track strip play button, and the Save button — so that the accent pops without overwhelming the neutral chrome.
41. As a user, I want a purple fallback (`#8b5cf6`) shown immediately while the artist colour is loading so that the UI never looks broken.
42. As a user, I want the extracted colour to be pre-computed on the server and stored in the database so that the client never has to wait for colour extraction on page load.

### Typography

43. As a user, I want Space Grotesk 700 used exclusively for artist names so that the display type creates a clear visual hierarchy.
44. As a user, I want Inter used for all other UI text — nav, reason text, genre tags, track names, buttons — so that the product feels cohesive and readable.

### Recommendation Engine — Underground Discovery

45. As a user, I want the recommendation feed to heavily favour artists with a Spotify popularity score of 0–30 (Underground) so that every visit surfaces artists I've genuinely never heard of.
46. As a user, I want artists with a popularity score of 31–60 (Mid) to appear occasionally so that there is some stepping-stone familiarity.
47. As a user, I want artists with a popularity score above 60 (Mainstream) to almost never appear in my recommendations so that the feed doesn't feel like a Top 40 playlist.
48. As a user, I want the popularity tiers weighted as: Underground 0–30 = `(100–popularity)² / 100² × 0.8`, Mid 31–60 = light positive weight, Mainstream 61–100 ≈ 0 so that the scoring formula reflects the priority.
49. As a user, I want Underground artists prioritised over Mid artists in the final ranked list so that the default experience is discovery-first.

### Recommendation Engine — Play Threshold

50. As a user, I want my configured play-threshold value (saved in Settings) to actually be read and used by the recommendation engine so that my preference has a real effect.
51. As a user, I want the play threshold to default to a very low value (≤ 5) so that new users immediately see artists they have never or barely played.
52. As a user, I want artists I've streamed more than my configured threshold to be excluded from recommendations so that familiar artists are filtered out.
53. As a user, I want to be able to set my play threshold in Settings and see its effect reflected on the next recommendation refresh so that the control is meaningful.

### Recommendation Engine — Last.fm Integration

54. As a user, I want my Last.fm scrobble history to be used to identify artists I've already heard so that the engine can filter them out even if Spotify's listening history is sparse.
55. As a user, I want the app to resolve my Last.fm artist names to Spotify artist IDs at sync time so that the engine's Spotify-ID-based filter can include Last.fm data.
56. As a user, I want the Last.fm sync to use the global `artist_search_cache` table for name-to-ID lookups so that no redundant Spotify search calls are made.
57. As a user, I want Last.fm artist rows that couldn't be resolved to a Spotify ID to be retried on the next sync rather than permanently discarded so that transient failures are recoverable.
58. As a user, I want an indicator in Settings when my Last.fm username is connected and synced so that I can confirm the integration is working.

### Track Pre-warming

59. As a user, I want the track strip on every feed card to show real track data immediately when the feed loads so that I never see a loading spinner on the strip.
60. As a user, I want the top-5 tracks for each recommended artist to be fetched from Spotify during recommendation generation and cached globally so that subsequent page loads are always cache hits.
61. As a user, I want the cached track data to be shared across all users (global cache) so that Spotify API calls are minimised across the entire user base.
62. As a user, I want track cache entries to have a TTL of at least 24 hours so that Spotify's rate limits are not hit on popular artists.

### Groups Cleanup

63. As a developer, I want all Groups-related API routes removed so that there are no dead endpoints in the codebase.
64. As a developer, I want the feedback route to stop creating `group_activity` rows so that there are no silent writes to orphaned tables.
65. As a developer, I want the `/join/[code]` route deleted so that invite links no longer resolve to anything.
66. As a developer, I want Groups removed from the nav everywhere (mobile bottom bar and desktop top nav) so that users never see a link to a removed feature.

### Settings

67. As a user, I want the Settings screen to use the same dark base tokens as the rest of the app so that it feels integrated rather than like a separate page.
68. As a user, I want to see a clearly labelled "Play Threshold" slider with a description explaining what it controls so that I understand what I'm adjusting.
69. As a user, I want to see a "Last.fm Username" field with a sync status indicator so that I know whether my scrobble history is connected.
70. As a user, I want the Settings page to use the full redesign treatment (dark chrome, Inter text, accent purple for interactive elements) so that it matches the rest of the app.

---

## Implementation Decisions

### Colour Extraction

- Use `node-vibrant` or `@vibrant/node` as a server-side dependency.
- Extract the dominant vibrant colour from each artist's Spotify image URL at recommendation-generation time (server-side, during the existing engine run).
- Before storing, verify the extracted hex passes WCAG AA contrast against `#000000` (button text colour). If it fails, lighten iteratively until it passes, or fall back to `--accent` (`#8b5cf6`).
- Store the extracted hex in a new `artist_color` column on the **global** `artist_search_cache` table (not per-user `recommendation_cache`). This means colour is extracted once per artist ever, regardless of how many users receive that artist.
- The client reads `artist_color` from the recommendation payload. If `null`, it renders `--accent` purple until the next generation cycle populates it.

### Track Pre-warming

- During recommendation generation (after the final ranked list is produced), for each artist in the result set, check `artist_tracks_cache` for a fresh entry (TTL: 24 hours).
- If stale or missing, fetch the artist's top tracks from the Spotify API and upsert into `artist_tracks_cache`.
- This is the **only** place track data is fetched from Spotify. The client always reads from cache via a lightweight `/api/artists/[id]/tracks` route; it never triggers a live Spotify call.
- Batch the pre-warm fetches in parallel (Promise.all) with a concurrency limit to stay within Spotify rate limits.

### Last.fm ID Resolution

- Add a resolution step to `accumulateLastFmHistory()`: after upserting Last.fm artist rows, query for rows where `spotify_artist_id IS NULL`.
- For each unresolved artist name, look up `artist_search_cache` first. If found, write the Spotify ID back to `listened_artists`. If not found, call Spotify's search API, upsert the result to `artist_search_cache`, then update `listened_artists`.
- Rows that return zero Spotify search results get a `spotify_artist_id` of a sentinel value (e.g., `'NOT_FOUND'`) to avoid re-querying them on every sync.
- The engine's existing "already heard" filter operates on `spotify_artist_id`; no engine changes are needed once IDs are resolved.

### Play Threshold

- The recommendation-generation API route currently hardcodes `playThreshold: 0`. Change this to read `profile.play_threshold` from the database for the authenticated user.
- `play_threshold` already exists as a column on the profiles table; only the API route needs to be updated.
- Default value for new users: `5` (artists played ≤ 5 times are still shown; artists played more are excluded).

### Popularity Tier Weighting

- Retain the existing discovery score formula structure.
- Apply a tier multiplier after scoring: Underground (0–30) × 1.0, Mid (31–60) × 0.25, Mainstream (61–100) × 0.02.
- After multiplier is applied, sort descending by weighted score.
- The tier cap logic (≤ 55 preferred, ≤ 65 fallback) is removed; the multiplier replaces it with a continuous soft preference rather than a hard cap.

### Visual Components

- **`globals.css`**: Add new CSS custom property tokens (`--bg-base`, `--bg-card`, `--bg-elevated`, `--border`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent`, `--accent-subtle`, `--accent-border`). Import Space Grotesk from Google Fonts.
- **`AppNav`**: Rebuild with 3-item bottom tab (mobile) and 3-link top bar (desktop). Remove all Groups references.
- **`ArtistCard`**: Full overhaul — hero image with gradient overlay, genre tag + artist name overlay, reason text, genre pills, track strip, action row. Entire card is one tap target. "Not for me" collapses card to slim bar with Undo. State is in-memory only (resets on refresh).
- **`TrackStrip`**: New standalone component. Accepts `tracks[]` and `artistColor`. Renders stacked thumbnails, featured track name, count, circular play button. Used in both feed cards and the Saved compact list.
- **`ArtistDrawer`**: New component. Slide-up sheet using Framer Motion spring. Accepts artist data including pre-warmed tracks and artist colour. Shows drag handle, header, reason text, genre pills, track list (5 default → 10 on "Show more"), footer. Dismissible via swipe-down, backdrop tap, or × button. Simultaneous close + card-collapse animation on "Not for me".
- **`FeedClient`**: Wire drawer open/close state. Pass selected artist to `ArtistDrawer`. Manage "Not for me" collapsed state per card (in-memory Map keyed by artist ID).
- **`SavedPage`**: Rebuild Artists tab as dense list with `TrackStrip`. Keep Tracks tab with minimal list row. Apply new type scale and colour tokens.
- **`MiniPlayer`**: Apply dark base tokens. Thread current artist colour to progress bar and thumbnail border. Brand purple for play/pause.
- **`SettingsForm`**: Apply new dark chrome styling. Play threshold slider reads/writes `play_threshold`. Last.fm field shows sync status.

### Schema Changes

- `artist_search_cache`: add `artist_color TEXT` column (nullable, populated at recommendation time).
- `listened_artists`: `spotify_artist_id` already exists as nullable; no schema change needed. A new `id_resolution_attempted_at` timestamp column is added so resolution retries are rate-limited.
- No other schema changes.

### Groups Cleanup

- Delete the `/join/[code]` API route entirely.
- In the feedback API route, remove the `group_activity` insert. Keep the thumbs-down upsert to `recommendation_feedback`.
- Remove all Groups navigation items from `AppNav` (both mobile and desktop).
- Remove any Groups-related pages and components not covered above.

### API Contracts

- `GET /api/artists/[id]/tracks` — returns cached top tracks for an artist. Never calls Spotify directly; reads from `artist_tracks_cache`. Returns `{ tracks: Track[] }`. If cache is cold (should not happen post-generation), returns empty array with `cache_miss: true` flag for telemetry.
- Recommendation generation route: reads `play_threshold` from user profile. Runs colour extraction and track pre-warming after ranking. Returns `artist_color` in each recommendation object.

---

## Testing Decisions

**What makes a good test:** Tests should assert observable behaviour through the module's public interface, not implementation details. A test should break only if the feature's behaviour changes, not if its internal code is refactored.

### Modules to Test

**`lib/recommendation/engine.ts`**
- Test that artists whose play count exceeds the threshold are excluded from results.
- Test that Underground artists (popularity 0–30) rank above Mid (31–60) given equal seed relevance.
- Test that Mainstream artists (popularity > 60) rank below Underground and Mid artists.
- Test that at least one result is returned when the artist pool is small (< 5 artists), even if all are mid/mainstream.
- Test that the engine returns results when `play_threshold` is 0 (all artists eligible).

**`lib/listened-artists.ts` (ID resolution)**
- Test that an artist row with `spotify_artist_id = NULL` and a cache hit gets updated with the correct ID.
- Test that an artist row that returns no Spotify search result gets the sentinel value rather than remaining NULL.
- Test that already-resolved rows (non-NULL `spotify_artist_id`) are not re-queried.

**`lib/colour-extraction.ts` (new module)**
- Test that a colour failing WCAG AA contrast against `#000000` is lightened until it passes before being returned.
- Test that the fallback colour (`#8b5cf6`) is returned when extraction throws.
- Test that the fallback colour is returned for a very dark extracted colour that cannot be lightened to pass contrast.

**`TrackStrip` component**
- Test that the correct number of stacked thumbnails renders.
- Test that the featured track name and "+ N more tracks" count display correctly.
- Test that the play button background uses the provided `artistColor`.
- Test that the fallback `--accent` purple is applied when no `artistColor` is given.

**`ArtistDrawer` component**
- Test that the drawer is not in the DOM when `isOpen` is false.
- Test that the drawer renders artist name, reason text, and top tracks when `isOpen` is true.
- Test that "Show more" reveals additional tracks up to 10.
- Test that the onDismiss callback is fired on backdrop tap.
- Test that the onDismiss callback is fired on × button click.

**`ArtistCard` component**
- Test that clicking the card body calls the onOpen handler.
- Test that the "Not for me" button collapses the card to a slim bar.
- Test that the slim bar shows an Undo button.
- Test that clicking Undo restores the full card.
- Test that the Save button uses the artist colour, not the brand purple, when `artistColor` is set.

### Prior Art

The codebase uses a standard Next.js + Jest/Vitest setup. Look for existing unit tests in `__tests__/` or `*.test.ts` files for pattern reference. Component tests use React Testing Library.

---

## Out of Scope

- **Light mode** — dark mode only; no light theme will be built.
- **Desktop-specific layout redesign** — the desktop feed and saved pages inherit the mobile card patterns with appropriate grid and spacing adjustments. No custom desktop grid layout.
- **Colour extraction UI controls or manual overrides** — users cannot manually set an artist's accent colour.
- **Onboarding / splash screen redesign** — out of scope for this PRD.
- **Last.fm "now playing" or real-time scrobble sync** — only historical top artists and recent tracks are fetched.
- **Spotify playlist integration changes** — the Flipside playlist feature is unchanged.
- **Groups feature rebuild** — Groups are removed, not rebuilt.
- **Offline support / PWA** — not in scope.
- **A/B testing or feature flags** — not in scope.

---

## Further Notes

- The approved design spec (`2026-04-08-visual-overhaul-design.md`) is the canonical visual reference. The component change summary at the bottom of that spec lists every component to be touched.
- Per-artist colour fallback must be applied client-side in CSS using `--accent` as the CSS custom property value until the artist colour is available. This avoids a flash of incorrect colour.
- Framer Motion is already installed. Use spring physics (not tween) for the drawer slide-up and card collapse animations to match the "expressive" animation direction chosen during design review.
- The single-column centred feed layout chosen for desktop means the card max-width should be capped (suggested: 640px) and centred, rather than expanding to fill the viewport.
- The `artist_tracks_cache` pre-warming step must run **after** the final ranked list is produced (not on every candidate in the pool) to avoid wasting Spotify API calls on artists that don't make the cut.
- Space Grotesk should be added to the Next.js font system via `next/font/google` (consistent with how Inter is loaded) rather than a `<link>` tag.

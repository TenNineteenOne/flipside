# Flipside Visual Overhaul — Design Spec

**Date:** 2026-04-08
**Status:** Approved

---

## Context

Flipside is a music discovery app that helps small groups of friends discover new artists based on their Spotify listening history. The current design uses a deep navy background, a teal accent colour, and generic SaaS card patterns that don't feel distinctly music-focused. The goal of this overhaul is to make Flipside feel like a premium, purpose-built music product — clean and professional, but unmistakably about music.

Groups have been removed from the app. The overhaul also introduces per-artist colour theming and a prominent track-preview strip to surface tracks directly in the feed without cluttering the default card view.

---

## Design Direction

**A+C Hybrid: Editorial meets intelligent list**

- Direction A contributes: full-bleed editorial artist imagery, bold display typography, a curated hero card feel
- Direction C contributes: "why you'd like this" reason text per artist, genre pill tags, a dense-but-clean list rhythm on the Saved screen
- Both directions share: dark mode only, near-black base, minimal chrome, per-artist colour identity

---

## Colour System

### Base Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-base` | `#080808` | Page/screen background |
| `--bg-card` | `#0f0f0f` | Card surfaces |
| `--bg-elevated` | `#141414` | Drawer, elevated sheets |
| `--border` | `rgba(255,255,255,0.08)` | All borders |
| `--text-primary` | `#eeeeee` | Artist names, headings |
| `--text-secondary` | `#888888` | Track names, secondary labels |
| `--text-muted` | `#444444` | Reason text, metadata |

### Brand / Fallback Accent

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#8b5cf6` | Nav active state, Saved hearts, drawer Save button, any element where no artist colour is loaded yet |
| `--accent-subtle` | `rgba(139,92,246,0.12)` | Accent tinted backgrounds |
| `--accent-border` | `rgba(139,92,246,0.25)` | Accent tinted borders |

### Per-Artist Dynamic Colour

Each artist card derives a single accent colour from its Spotify image at load time (using a colour extraction library such as `node-vibrant` or `@vibrant/node`). This colour is applied to exactly four elements per card:

1. Genre/category tag text
2. Track strip background tint + border
3. Track strip play button
4. "Save artist" action button

The base chrome (nav, card background, reason text, tags) always stays neutral so the accent pops cleanly. When an artist colour is not yet loaded, `--accent` (`#8b5cf6`) is used as the fallback.

**Example artist colours (illustrative, extracted at runtime):**
- Bon Iver → warm gold `#d4a017`
- Arooj Aftab → teal `#2dd4bf`
- Weyes Blood → violet (falls back to brand purple)
- Sudan Archives → rose `#fb7185`

---

## Typography

### Display Font: Space Grotesk (Bold/700)
- Source: Google Fonts — free, no licence required
- Usage: Artist names on feed cards, artist name in expanded drawer header
- Weight: 700
- Letter-spacing: `-0.02em`
- Applied to `.artist-name` and `.drawer-artist-name` only

### UI Font: Inter (existing)
- Already loaded in the app via `next/font/google`
- Usage: all UI text — nav, reason text, genre tags, track names, metadata, buttons
- Weights: 400, 500, 600, 700

**Rule:** Space Grotesk is used exclusively for artist names. Everything else stays Inter.

---

## Layout & Navigation

### Navigation Structure

**Mobile (< 768px):** Bottom tab bar, fixed, 3 items:
- ⚡ Feed (default)
- ♡ Saved
- ⚙ Settings

**Desktop (≥ 768px):** Top nav bar with logo left, links centre/right, avatar right. Same 3 destinations.

Groups have been removed from the nav entirely.

### Nav Visual Treatment
- Background: `rgba(8,8,8,0.92)` + `backdrop-filter: blur(16px)`
- Border: `1px solid rgba(255,255,255,0.06)` (bottom for top nav, top for bottom nav)
- Logo: "flipside" in white, Inter 700
- Active item: `--accent` purple
- Avatar: small circle with `--accent-subtle` background and `--accent` initial

---

## Feed Screen

### Artist Card (Collapsed)

Structure top-to-bottom:

1. **Hero image** — full-bleed, no border radius on the image itself, just the card corners. Height ~150px on mobile. Gradient overlay fades image into card background (`linear-gradient(to top, var(--bg-card) 0%, transparent 100%)`).
2. **Genre tag + artist name** — overlaid on the image at bottom-left. Genre tag: 8px Inter 600, uppercase, letter-spacing 0.18em, artist colour. Artist name: Space Grotesk 700, 24–28px depending on name length, white.
3. **Reason text** — 10px Inter 400, `--text-muted`, max 2 lines. "Because you listen to X and Y — [description]."
4. **Genre pills** — small tag chips, 8px Inter 500 uppercase. Background `#141414`, border `#1e1e1e`, text `#444`.
5. **Track strip** — see below.
6. **Action row** — "👎 Not for me" (ghost button) and "+ Save" (filled, artist colour). Both 30px height, `border-radius: 8px`.

### Track Strip (the key interactive element)

The track strip replaces the old subtle row. It is the primary invitation to tap and explore tracks.

```
[ album art × 3 stacked ] [ ▶ Track Name    ] [ ● ]
                           [ + N more tracks ]
```

- Outer container: `margin: 7px 10px 9px`, `border-radius: 10px`, `padding: 9px 11px`
- Background: `rgba(artistColor, 0.09)`, border: `1px solid rgba(artistColor, 0.22)`
- Three stacked album art thumbnails: 26×26px, `border-radius: 5px`, overlapping by 8px
- Centre: featured track name (11px Inter 500, `#ddd`) + "+ N more tracks" count (9px Inter 400, `#444`)
- Right: circular play button, 28px, `background: artistColor`, `color: #000`

Tapping the strip opens the Artist Detail Drawer. The entire card (hero image, body, and strip) is tappable and triggers the same drawer — there is no tap-target ambiguity.

---

## Artist Detail Drawer

Triggered by tapping the track strip or the card body. Slides up from the bottom, revealing the collapsed card behind it (card image still visible, dimmed).

### Structure

1. **Drag handle** — 30px wide, 3px tall, `#222`, centered, `margin-top: 9px`
2. **Header** — artist name (13px Inter 600), listener count (10px muted), "+ Save artist" button (artist colour if loaded, otherwise `--accent` purple, 28px height)
3. **Reason text** — same as card but fully visible (not clamped)
4. **Genre pills** — same as card
5. **"TOP TRACKS" label** — 9px Inter 600, uppercase, `--text-muted`
6. **Track list** — top 5 tracks. First track highlighted (slightly elevated row background, artist-colour play button, white text). Remaining tracks: muted text, grey idle play buttons.
7. **Footer** — "Open in Spotify" (green dot icon + text, muted) on left. "👎 Not for me" (very muted) on right.

### Track Row

```
[ num ] [ 30×30 album art ] [ Track Name    ] [ ▶ ]
                             [ duration      ]
```

- `border-radius: 8px` on row
- Playing row: `background: #161616`, track name `#eee`, play button uses `--accent` purple (not artist colour — the drawer is app chrome)
- Idle rows: track name `#888`, play buttons `#141414` with border

### Backdrop
- Drawer sits on `z-index: 10`
- A `rgba(0,0,0,0.55)` scrim covers the feed behind the drawer
- The artist's hero card image is still partially visible above the drawer top edge

---

## Saved Screen

### Artists tab (default)

Dense list of saved artists. Each row:

```
[ 46×46 artist img ] [ Artist Name (Space Grotesk 16px)  ] [ ♥ ]
                      [ GENRE · SUBGENRE (9px caps)       ]
                      [ track strip (compact)             ]
```

The compact track strip on the Saved screen is the same pattern as the feed but smaller (16px thumbnails, 9px text). It uses the artist's dynamic colour, same as the feed.

### Tracks tab

List of individually saved tracks (existing feature). Layout TBD during implementation — keep existing pattern but apply new type scale and colour tokens.

---

## Mini Player

The existing fixed-bottom mini player is retained. Visual treatment: match the new dark base, use `--accent` purple for the play/pause button, apply the currently-playing artist's dynamic colour to the progress bar and track thumbnail border.

---

## Colour Extraction Implementation

Use `node-vibrant` or `@vibrant/node` (to be added as a dependency) on the server to extract a dominant vibrant colour from each Spotify artist image URL at recommendation-generation time. Store the extracted hex value alongside the artist record in the database. Fall back to `--accent` (`#8b5cf6`) if extraction fails or the colour is too dark/low-contrast for the dark background.

**Contrast safety:** Before applying an extracted colour as a text or button colour, verify it passes WCAG AA contrast against `#000000` (used as button text). If it fails, lighten it until it passes or fall back to `--accent`.

---

## Component Change Summary

| Component | Change |
|-----------|--------|
| `globals.css` | New colour tokens, import Space Grotesk |
| `AppNav` | 3 items only (remove Groups), new visual treatment |
| `ArtistCard` | Full overhaul — hero image, reason text, genre tags, track strip |
| `TrackStrip` | New component — replaces old subtle track row |
| `ArtistDrawer` | New component — slides up over card, shows full track list |
| `FeedClient` | Wire up drawer open/close state |
| `SavedPage` | Compact artist list with track strip, Tracks tab |
| `MiniPlayer` | Dynamic colour on progress bar + thumbnail border |

---

## Out of Scope

- Groups feature (removed)
- Light mode
- Desktop layout redesign beyond nav (desktop feed and saved pages will inherit mobile card patterns with appropriate grid/spacing adjustments)
- Colour extraction UI controls or manual overrides
- Onboarding / splash screen redesign

---

## Verification

1. **Feed loads** with new card layout — hero image, genre tag, reason text, genre pills, track strip, action row
2. **Track strip** shows first track name, thumbnail stack, "+ N more" count, and coloured play button
3. **Tapping track strip** opens the Artist Detail Drawer with full track list
4. **Track plays** via mini player when a play button is tapped
5. **Save button** colour matches the artist's dynamic colour (not always purple)
6. **Nav** shows Feed / Saved / Settings only (no Groups)
7. **Saved screen** shows compact artist list with per-artist track strip
8. **Fallback colour** is purple (`#8b5cf6`) when artist colour is not loaded
9. **Space Grotesk** renders on artist names; Inter renders on all other text
10. **Mobile and desktop** both render correctly at 375px and 1280px viewport widths

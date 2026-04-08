# Issue 09 — TrackStrip Component

**Type:** AFK
**Blocked by:** Issue 02 (CSS tokens must exist first)

## What to build

Create a new `TrackStrip` component used in both the feed `ArtistCard` and the compact `SavedPage` artist list. It is the primary visual invitation to explore an artist's tracks.

### Visual spec

```
[ album art × 3 stacked ] [ ▶ Track Name    ] [ ● play button ]
                           [ + N more tracks ]
```

- **Outer container:** `margin: 7px 10px 9px`, `border-radius: 10px`, `padding: 9px 11px`
- **Background:** `rgba(artistColor, 0.09)`
- **Border:** `1px solid rgba(artistColor, 0.22)`
- **Three stacked album art thumbnails:** 26×26px, `border-radius: 5px`, overlapping by 8px (negative left margin), each with a 2px `--bg-base` separator border
- **Centre column:**
  - Featured track name: 11px Inter 500, `#ddd`, with a ▶ prefix
  - "+ N more tracks" count: 9px Inter 400, `--text-muted` (`#444`)
- **Right:** circular play button, 28px diameter, `background: artistColor`, `color: #000`, contains ▶

### Props

```typescript
interface TrackStripProps {
  tracks: Track[]            // Full track list; strip shows first track + count of remainder
  artistColor?: string       // Hex string; defaults to '#8b5cf6' (--accent)
  compact?: boolean          // When true, use 16px thumbnails and 9px text (for Saved screen)
  onPlay?: (track: Track) => void
  onOpen?: () => void        // Called when strip is tapped (opens drawer)
}
```

### Behaviour

- Tapping the strip calls `onOpen` (which will open the Artist Detail Drawer).
- Tapping the circular play button calls `onPlay` with the featured track, then also calls `onOpen`.
- If `tracks` is empty, render nothing (null).
- The `artistColor` is applied as an inline CSS custom property on the container so `rgba(artistColor, 0.09)` can be computed via CSS. Use a CSS variable pattern, e.g. `style={{ '--strip-color': artistColor }}` and reference it in CSS with `rgba(var(--strip-color-r), var(--strip-color-g), var(--strip-color-b), 0.09)` — or use the hex directly in an inline style if simpler.

### Notes

- Read the design spec at `docs/superpowers/specs/2026-04-08-visual-overhaul-design.md` § "Track Strip" for the full visual reference.
- The component should be in `components/feed/track-strip.tsx`.
- Do not wire this to any real track-fetching logic — it receives `tracks` as a prop. Data fetching is handled by the parent.

## Acceptance criteria

- [ ] Strip renders with three stacked album art thumbnails, featured track name, count, and play button
- [ ] Background and border use `rgba(artistColor, 0.09)` and `rgba(artistColor, 0.22)` respectively
- [ ] Play button uses `artistColor` as background
- [ ] When `artistColor` is not provided, `#8b5cf6` is used for all colour elements
- [ ] `compact` prop renders smaller thumbnails (16px) and smaller text (9px)
- [ ] Tapping the strip calls `onOpen`
- [ ] Tapping the play button calls `onPlay` with the first track
- [ ] Component renders nothing when `tracks` is empty
- [ ] Component tests cover: default colour, custom colour, compact mode, empty tracks

## Blocked by

- Blocked by Issue 02 (CSS tokens)

## User stories addressed

- Story 6: Track strip shows stacked thumbnails, track name, "+ N more tracks", coloured play button
- Story 7: Track strip is a tap target to open the drawer
- Story 40: Artist colour applied to strip background tint, border, and play button
- Story 41: Purple fallback when no artist colour provided

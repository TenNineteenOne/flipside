# Issue 10 — ArtistCard Visual Overhaul

**Type:** AFK
**Blocked by:** Issue 02 (CSS tokens), Issue 09 (TrackStrip component)

## What to build

Fully rebuild `components/feed/artist-card.tsx` to match the approved design direction. The existing card is a placeholder; this replaces it entirely.

### Card structure (top to bottom)

1. **Hero image** — full-bleed, no border radius on the image itself (card has `border-radius: 12px` with `overflow: hidden`). Height ~150px on mobile. Gradient overlay: `linear-gradient(to top, var(--bg-card) 0%, transparent 100%)`.

2. **Genre tag + artist name** — absolutely positioned at the bottom-left of the hero image.
   - Genre tag: 8px Inter 600, uppercase, `letter-spacing: 0.18em`, `color: artistColor`
   - Artist name: Space Grotesk 700, 24–28px (shorter names get 28px), `color: var(--text-primary)`, `letter-spacing: -0.02em`

3. **Reason text** — below the image, 10px Inter 400, `var(--text-muted)`, clamped to 2 lines. Format: "Because you listen to X and Y — [description]."

4. **Genre pills** — small chips, 8px Inter 500 uppercase. Background `#141414`, border `1px solid #1e1e1e`, text `#444`.

5. **TrackStrip** — use the `TrackStrip` component from Issue 09. Pass `tracks`, `artistColor`, and an `onOpen` handler that fires the drawer.

6. **Action row** — two buttons, 30px height, `border-radius: 8px`:
   - "👎 Not for me" — ghost button (transparent background, `--text-muted` text)
   - "+ Save" — filled, background `artistColor`, text `#000`

### Entire card is one tap target

The card background, hero image, reason text, genre pills, and track strip all trigger `onOpen` (the drawer). The "Not for me" and "+ Save" buttons have their own handlers and stop propagation.

### "Not for me" collapse animation

When "Not for me" is tapped:
1. Animate the card collapsing to a slim bar (~48px height) using Framer Motion's `layout` prop and spring physics.
2. The slim bar shows: artist name (truncated, `--text-secondary`), "Not for me" label (`--text-muted`, smaller), and an "Undo" button (ghost, right-aligned).
3. Tapping "Undo" animates the card expanding back to full height.
4. This state is **in-memory only** — do not persist to the database, do not call any API. The card reappears at full height on page refresh.

### Props

```typescript
interface ArtistCardProps {
  recommendation: Recommendation  // Existing type, extended with artist_color: string | null
  onOpen: () => void              // Open the Artist Detail Drawer
  onSave: () => void
  onDismiss: () => void           // "Not for me" — calls parent to record, card handles animation
}
```

### Artist colour

Accept `artistColor?: string` (from `recommendation.artist_color`). Default to `#8b5cf6` if null. Pass to:
- Genre tag text colour
- TrackStrip `artistColor` prop
- Save button background

### Notes

- Read the full card spec in `docs/superpowers/specs/2026-04-08-visual-overhaul-design.md` § "Artist Card (Collapsed)".
- Framer Motion is already installed. Use `<motion.div>` with `animate`, `layout`, and spring transition.
- The card background is `var(--bg-card)` (`#0f0f0f`). Card border: `1px solid var(--border)`.
- For desktop, the card should be max-width 640px, centred — this is handled by the feed layout, not the card itself.

## Acceptance criteria

- [ ] Card renders hero image with gradient overlay
- [ ] Genre tag and artist name overlay the bottom-left of the hero image
- [ ] Artist name uses Space Grotesk 700
- [ ] Genre tag text uses `artistColor` (purple fallback if null)
- [ ] Reason text is clamped to 2 lines
- [ ] Genre pills are visible below reason text
- [ ] TrackStrip is rendered with the correct `artistColor`
- [ ] Save button uses `artistColor` as background
- [ ] Tapping the card body (not buttons) calls `onOpen`
- [ ] "Not for me" collapses card to slim bar with spring animation
- [ ] Slim bar shows artist name, "Not for me" label, and Undo button
- [ ] Tapping Undo re-expands the card with a spring animation
- [ ] "Not for me" and Save buttons stop event propagation (don't trigger `onOpen`)
- [ ] Component tests cover: render, colour prop, dismiss/undo flow, tap target

## Blocked by

- Blocked by Issue 02 (CSS tokens)
- Blocked by Issue 09 (TrackStrip component)

## User stories addressed

- Stories 1–12: Full card layout, genre tag, artist name, reason text, genre pills, track strip, action row, "Not for me" collapse, Undo
- Stories 39–41: Per-artist colour, four application points, purple fallback
- Stories 43–44: Space Grotesk for artist name, Inter for everything else

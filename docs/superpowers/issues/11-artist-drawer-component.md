# Issue 11 — ArtistDrawer Component

**Type:** AFK
**Blocked by:** Issue 09 (TrackStrip), Issue 10 (ArtistCard)

## What to build

Create a new `ArtistDrawer` component that slides up from the bottom when a card or track strip is tapped. This is the primary track-exploration surface.

### Visual structure (top to bottom)

1. **Drag handle** — 30px wide, 3px tall, `#222`, centred, `margin-top: 9px`
2. **Header row:**
   - Artist name: 13px Inter 600, `--text-primary`
   - Listener count: 10px Inter 400, `--text-muted`
   - "+ Save artist" button: 28px height, `border-radius: 8px`, background `artistColor` (or `--accent` fallback), text `#000`
3. **Reason text** — full (not clamped), 11px Inter 400, `--text-muted`
4. **Genre pills** — same as card
5. **"TOP TRACKS" label** — 9px Inter 600, uppercase, `--text-muted`
6. **Track list** — 5 tracks by default, "Show more" expands to 10
7. **Footer:**
   - Left: "Open in Spotify" (green dot icon + Inter 400 text, `--text-muted`)
   - Right: "👎 Not for me" (Inter 400, very muted)

### Track row structure

```
[ num ] [ 30×30 album art ] [ Track Name    ] [ ▶ ]
                             [ duration      ]
```

- `border-radius: 8px` on the row
- **Playing row:** background `#161616`, track name `#eee`, play button uses `--accent` purple (not artistColor — drawer is app chrome)
- **Idle rows:** track name `#888`, play button `#141414` with border `1px solid #1e1e1e`
- Track number: 10px Inter 400, `--text-muted`
- Duration: 9px Inter 400, `--text-muted`

### Animations (use Framer Motion, spring physics — not tween)

- **Open:** slide up from `y: '100%'` to `y: 0` with a spring (`stiffness: 400, damping: 40` or similar — should feel snappy and alive)
- **Close:** reverse slide down
- **"Not for me" from drawer:** simultaneously close the drawer AND trigger the card's collapse animation. The `onDismiss` callback should fire both actions at once.
- Do not use CSS transitions for these; use Framer Motion throughout.

### Dismiss methods (all three must work)

1. **Swipe down** — drag the drawer downward; if dragged > 100px, dismiss
2. **Tap backdrop** — the semi-transparent scrim behind the drawer
3. **× button** — top-right corner of the drawer

### Backdrop

- `position: fixed`, `inset: 0`, `z-index: 9`, `background: rgba(0,0,0,0.55)`
- Drawer sits at `z-index: 10`
- The artist's card hero image is partially visible above the drawer top edge (the card is still rendered behind the scrim, just dimmed)

### "Show more"

- Default: 5 tracks visible
- Tapping "Show more" expands to 10 tracks with a smooth height animation
- "Show more" button: 10px Inter 400, `--text-muted`

### Props

```typescript
interface ArtistDrawerProps {
  artist: ArtistWithTracks | null
  artistColor: string
  isOpen: boolean
  onDismiss: () => void      // Close drawer only
  onDismissAndCollapse: () => void  // Close drawer + collapse card (for "Not for me")
  onSave: () => void
  currentTrackId?: string    // ID of currently playing track
  onPlay: (track: Track) => void
}
```

### Notes

- Read the drawer spec in `docs/superpowers/specs/2026-04-08-visual-overhaul-design.md` § "Artist Detail Drawer".
- Component file: `components/feed/artist-drawer.tsx`
- The drawer should not unmount immediately on close — animate out first, then unmount. Use Framer Motion's `AnimatePresence`.

## Acceptance criteria

- [ ] Drawer is absent from DOM when `isOpen` is false
- [ ] Drawer slides up with a spring animation when `isOpen` becomes true
- [ ] Drawer slides down when dismissed
- [ ] All three dismiss methods work: swipe-down, backdrop tap, × button
- [ ] "Show more" expands track list from 5 to 10 with animation
- [ ] Currently-playing track row has elevated background and `--accent` play button
- [ ] Idle track rows are muted
- [ ] "Open in Spotify" link is present in footer
- [ ] "Not for me" in footer fires `onDismissAndCollapse`, closing drawer and collapsing card simultaneously
- [ ] Save button uses `artistColor`
- [ ] Component tests: not in DOM when closed; renders artist name and tracks when open; Show more works; backdrop tap fires onDismiss; × fires onDismiss

## Blocked by

- Blocked by Issue 09 (TrackStrip)
- Blocked by Issue 10 (ArtistCard — needed for simultaneous collapse animation)

## User stories addressed

- Stories 13–26: Full drawer spec — slide-up, drag handle, header, reason, genre pills, track list, show more, track rows, playing state, footer, dismiss methods, simultaneous collapse

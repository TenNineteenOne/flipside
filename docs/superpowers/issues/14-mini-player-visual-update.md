# Issue 14 — MiniPlayer Visual Update

**Type:** AFK
**Blocked by:** Issue 02 (CSS tokens)

## What to build

Update `components/player/mini-player.tsx` to use the new dark base tokens and thread the currently-playing artist's dynamic colour through to the progress bar and track thumbnail border.

### Visual changes

- **Background:** `var(--bg-elevated)` (`#141414`) — replaces whatever the current background is
- **Border-top:** `1px solid var(--border)` (`rgba(255,255,255,0.08)`)
- **Track thumbnail:** `border-radius: 6px`, with a 2px coloured border using the artist's dynamic colour
- **Progress bar filled portion:** use the artist's dynamic colour instead of the current teal/blue
- **Progress bar track (unfilled):** `var(--bg-card)` or `rgba(255,255,255,0.08)`
- **Play/pause button:** `--accent` purple (`#8b5cf6`) — always brand purple, not the artist colour
- **Track name:** Inter 12px 500, `--text-primary`
- **Artist name:** Inter 11px 400, `--text-secondary`

### Artist colour threading

The mini player needs to know the currently-playing artist's `artistColor`. This should already be available via the audio context or mini player state (the mini player receives the track being played). Extend the track/play state to include `artistColor?: string` alongside the track data. Fallback to `#8b5cf6` if not provided.

### Layout

Keep the existing layout (fixed bottom, full width, above the mobile bottom nav). No structural changes — only visual treatment.

### Notes

- Read the mini player spec in `docs/superpowers/specs/2026-04-08-visual-overhaul-design.md` § "Mini Player".
- Ensure the mini player sits above the mobile bottom nav (z-index and bottom offset may need updating after the nav rebuild in Issue 03).

## Acceptance criteria

- [ ] Mini player background is `#141414` (dark, not the old navy)
- [ ] Play/pause button is `#8b5cf6` purple
- [ ] Progress bar filled portion uses the currently-playing artist's dynamic colour (purple fallback if no colour)
- [ ] Track thumbnail has a 2px border in the artist's dynamic colour
- [ ] Mini player does not overlap the bottom nav bar on mobile

## Blocked by

- Blocked by Issue 02 (CSS tokens)

## User stories addressed

- Story 27: Mini player inherits new dark base colours
- Story 28: Artist's dynamic colour on progress bar and thumbnail border
- Story 29: Brand purple for play/pause button

# Issue 13 — Saved Screen Rebuild

**Type:** AFK
**Blocked by:** Issue 02 (CSS tokens), Issue 09 (TrackStrip)

## What to build

Rebuild `app/(app)/saved/page.tsx` and its client component to match the new design. Two tabs: Artists (default) and Tracks.

### Artists tab (default)

Dense list of saved artists. Each row:

```
[ 46×46 artist img, border-radius: 8px ]
  [ Artist Name — Space Grotesk 16px, --text-primary ]
  [ GENRE · SUBGENRE — 9px Inter 500 uppercase, --text-muted ]
  [ TrackStrip (compact mode) ]
[ ♥ unsave button — --accent purple ]
```

- Row background: `var(--bg-card)`
- Row border-bottom: `1px solid var(--border)`
- Artist image: 46×46px, `border-radius: 8px`, object-fit cover
- Artist name: Space Grotesk 16px 700, `--text-primary`
- Genre line: 9px Inter 500 uppercase, `--text-muted`, genres joined with ` · `
- TrackStrip: use the `TrackStrip` component with `compact={true}` and the artist's `artistColor`
- ♥ button: right-aligned, `--accent` purple, tapping removes artist from saved list

### Tracks tab

List of individually saved tracks. Minimal list row:

```
[ 36×36 album art ] [ Track Name — Inter 13px 500, --text-primary ]
                     [ Artist Name — Inter 11px 400, --text-secondary ]
[ duration — Inter 10px 400, --text-muted ]
```

- Apply new type scale and colour tokens to match the rest of the app
- Keep existing data fetching logic — only the visual layer changes

### Empty state (Artists tab)

If the user has no saved artists:
- Show a simple message: "No saved artists yet"
- If the user has no `lastfm_username` set on their profile, add a nudge: "Connect Last.fm to discover artists based on your full listening history" with a link to Settings
- Style: centred, `--text-muted`, Inter 13px

### Notes

- Read the Saved spec in `docs/superpowers/specs/2026-04-08-visual-overhaul-design.md` § "Saved Screen".
- The TrackStrip in the Saved screen opens the Artist Detail Drawer the same way the feed does. Wire the same drawer pattern here if feasible, or at minimum make the strip tappable with a visual affordance (can be deferred to a follow-up issue if complexity is high).
- Saved artists may not have `artist_color` in the database yet (if they were saved before Issue 06 shipped). Fallback to `#8b5cf6` for those rows.

## Acceptance criteria

- [ ] Artists tab renders a dense list with 46×46 image, Space Grotesk name, genre line, compact TrackStrip
- [ ] Compact TrackStrip uses the artist's colour (or purple fallback)
- [ ] ♥ button removes artist from saved list
- [ ] Tracks tab renders a minimal list with album art, track name, artist name, duration
- [ ] New colour tokens and type scale applied to both tabs
- [ ] Empty state shows Last.fm nudge if `lastfm_username` is not set
- [ ] Both tabs are reachable via tab switcher at the top of the screen

## Blocked by

- Blocked by Issue 02 (CSS tokens)
- Blocked by Issue 09 (TrackStrip)

## User stories addressed

- Story 34: Saved screen defaults to Artists tab
- Story 35: Each saved artist row has photo, Space Grotesk name, genre tags, compact TrackStrip
- Story 36: Compact TrackStrip uses artist dynamic colour
- Story 37: Tracks tab shows saved tracks in minimal list
- Story 38: Empty state with Last.fm nudge

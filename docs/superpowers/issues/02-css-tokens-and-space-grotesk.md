# Issue 02 — CSS Design Tokens + Space Grotesk

**Type:** AFK
**Blocked by:** None — start immediately

## What to build

Replace the existing `globals.css` colour scheme with the new design token set and load Space Grotesk as the display typeface for artist names.

### Colour tokens to add

```
--bg-base:        #080808   (page/screen background)
--bg-card:        #0f0f0f   (card surfaces)
--bg-elevated:    #141414   (drawer, elevated sheets)
--border:         rgba(255,255,255,0.08)   (all borders)
--text-primary:   #eeeeee   (artist names, headings)
--text-secondary: #888888   (track names, secondary labels)
--text-muted:     #444444   (reason text, metadata)
--accent:         #8b5cf6   (nav active state, hearts, save buttons, fallback)
--accent-subtle:  rgba(139,92,246,0.12)   (accent tinted backgrounds)
--accent-border:  rgba(139,92,246,0.25)   (accent tinted borders)
```

Remove or replace the existing deep navy + teal colour variables. Update the `body` background and base text colour to use the new tokens.

### Typography

Load Space Grotesk (weight 700) via `next/font/google` — the same pattern already used for Inter. Expose it as a CSS variable (e.g. `--font-display`) so it can be referenced in component styles. Do NOT apply it globally; it will be applied only to `.artist-name` elements in later issues.

Inter stays as-is; no changes needed there.

### Notes

- Read the Next.js font guide in `node_modules/next/dist/docs/` before touching font loading — this version has breaking changes.
- The existing Tailwind theme variables in `@theme inline` should be updated to map to the new hex values where appropriate, so Tailwind utilities continue to work.

## Acceptance criteria

- [ ] `--bg-base` through `--accent-border` CSS custom properties exist on `:root`
- [ ] `body` background renders as `#080808`, not the old deep navy
- [ ] Space Grotesk 700 is loaded and available as a CSS variable
- [ ] Inter is still loaded and unchanged
- [ ] The app builds without errors

## Blocked by

None — can start immediately.

## User stories addressed

- Story 2: Bold display typeface (Space Grotesk 700) available for artist names
- Story 41: Purple fallback `#8b5cf6` defined as `--accent`
- Story 43: Space Grotesk available exclusively for artist name use
- Story 44: Inter available for all other UI text

# Issue 03 — Nav: Add Settings + New Visual Treatment

**Type:** AFK
**Blocked by:** Issue 02 (CSS tokens must exist first)

## What to build

Update `components/nav/app-nav.tsx` to add Settings as the third nav destination and apply the new visual treatment from the design spec.

### Navigation destinations (exactly three, in order)

- ⚡ Feed → `/feed`
- ♡ Saved → `/saved`
- ⚙ Settings → `/settings`

No Groups link anywhere.

### Mobile (< 768px)

Bottom tab bar, fixed to the bottom of the viewport:
- Height: 64px
- Background: `rgba(8,8,8,0.92)` + `backdrop-filter: blur(16px)`
- Top border: `1px solid rgba(255,255,255,0.06)`
- Each item: icon + label, stacked vertically, centred
- Active item text and icon: `--accent` purple (`#8b5cf6`)
- Inactive: `--text-muted` (`#444`)

### Desktop (≥ 768px)

Top nav bar, sticky:
- Height: 56px
- Background: `rgba(8,8,8,0.92)` + `backdrop-filter: blur(16px)`
- Bottom border: `1px solid rgba(255,255,255,0.06)`
- Logo: "flipside" left-aligned, Inter 700, white
- Nav links: centred or right-aligned, same three destinations
- Active link: `--accent` purple
- Avatar: small circle, `--accent-subtle` background, `--accent` initial letter

### Notes

- The breakpoint in the existing component is at `md` (768px) — keep this.
- Read the design spec at `docs/superpowers/specs/2026-04-08-visual-overhaul-design.md` § "Navigation" for full spec.

## Acceptance criteria

- [ ] Mobile bottom bar shows exactly: Feed, Saved, Settings
- [ ] Desktop top bar shows exactly: Feed, Saved, Settings (plus logo and avatar)
- [ ] No Groups link appears anywhere in the nav at any viewport width
- [ ] Active nav item renders in `#8b5cf6` purple
- [ ] Nav background uses the frosted-glass blur treatment
- [ ] Switching between Feed, Saved, Settings routes works correctly

## Blocked by

- Blocked by Issue 02 (CSS tokens + fonts)

## User stories addressed

- Story 30: Mobile bottom tab bar — Feed, Saved, Settings only
- Story 31: Desktop top nav — same three destinations
- Story 32: Active nav item in accent purple
- Story 33: Frosted-glass blur nav background
- Story 66: No Groups link in nav

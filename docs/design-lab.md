---
title: Design lab (redesign prototypes)
updated: 2026-11-09
---

# Design lab

Five working redesign prototypes of Flipside, a gallery to compare them, and a
scale/performance audit of the real app. Prototypes only: mock data, local state,
no auth, no database. Nothing under `/lab` is wired to the real app.

## Decision (2026-11-09)

- **Chosen direction: Evolved.** Flux picked it after reviewing all five in the gallery.
- **The other four are parked, not rejected.** Keep the code so they can be revisited.
- **Mobile matters as much as desktop.** Evolved got a dedicated phone design pass
  (one artist at a time, swipe to triage, thumb-zone controls) on the same day.
- **Not decided yet:** whether any mechanic from a parked direction gets folded into
  Evolved (the lab's recommendation was Daily Drop's finite daily set + share card),
  and when the audit fixes get done.

## Where it lives

- Branch `design-lab`, cut from `Nick` at `25a57d0`. Worktree at
  `.claude/worktrees/design-lab` (the worktree can be deleted; the branch keeps everything).
- Routes: `/lab` (gallery), `/lab/<slug>` (landing), `/lab/<slug>/app` (signed-in app).
- Code: `app/lab/<slug>/`, `components/lab/<slug>/`, shared bits in `lib/lab/` and
  `components/lab/`. Each direction is self-contained and scoped under `.lab-<slug>`.
- Mock data: `lib/lab/artists.json` (19 artists, real iTunes artwork and 30s previews),
  regenerated with `node scripts/lab-fetch-artists.mjs`.

## Run it

```bash
npm ci
printf 'AUTH_SECRET=design-lab-local-only-not-a-real-secret-0000\nNEXT_PUBLIC_APP_URL=http://localhost:3210\n' > .env.local
npm run dev -- -p 3210
```

Open `http://localhost:3210/lab`. On a phone on the same Wi-Fi, open
`http://<this-mac's-LAN-IP>:3210/lab/evolved` (add the address to `LAB_DEV_ORIGINS` in `.env.local`, comma-separated).

The dummy `AUTH_SECRET` is deliberate: the lab must never be pointed at the real
Supabase project.

Screenshots: `scripts/lab-shot.sh <url> <out.png>` (desktop) and
`node scripts/lab-shot-mobile.mjs <url> <out.png> 390 844` (true phone emulation).

## The five directions

| Slug | Idea | Look | Est. cost to build for real |
|---|---|---|---|
| `evolved` **(chosen)** | Three-pane desktop triage layout, one triage control, full keyboard control, playable landing card | Dark, violet accent, artist-colour tints; no glow, blur or grain | 3–5 days + ~2 days for the phone shell (`components/lab/evolved/mobile-shell.tsx`) and real-device QA |
| `bside` | Every artist is a record sleeve that flips in 3D; keep/pass are physical piles | Light, drenched in each record's colour | About a week |
| `tuner` | A radio: previews chain back to back, a tuning dial replaces the feed, live visualiser | Dark hi-fi faceplate, amber dial light | 1–2 weeks (iOS/Safari audio) |
| `atlas` | `data/genres.json` drawn as a pannable map of 6,291 genres; recommendations are pins past your border | Light, printed-map inks | 2–3 weeks; could ship as the Explore tab only |
| `drop` | Five artists a day, swipe to decide, streak, shareable result card | Bright riso gig poster | 2–3 weeks (needs a drops table and generator) |

Estimates are the builders' own rough guesses, not measured.

Portable ideas, independent of skin, are listed in `lib/lab/features.ts`.

## What Evolved changes in the real app

- Rewrite `app/page.tsx` (landing with a playable card).
- Feed shell becomes rail + queue + focus pane on desktop, single-artist card stack on phones.
- `components/feed/artist-card.tsx` splits into queue row, focus pane and triage control.
- Player gains a docked variant; add a keyboard hook and an optimistic-update + undo wrapper
  around the existing like / pass / dismiss / bookmark handlers.
- `app/globals.css`: drop grain and glow, new tokens. Root layout: two font families
  (Familjen Grotesk, Martian Mono) instead of four.
- Explore, History, Saved, Stats, Settings only inherit the shell and tokens.

## Audit of the real app

A launch-scale and front-end performance audit was done on 2026-11-09. It is deliberately not in
this public branch. It lives on the local-only branch `design-lab-full` in `lib/lab/findings.ts`
and in that branch's copy of this file. Two front-end items from it are part of the Evolved PRD
(static landing page; no grain, blur, or extra font families).

## Known gaps in the prototypes

- Not tested on a real phone, in Safari or Firefox. Touch drag/swipe was exercised with
  synthetic events only in most directions.
- Tuner's audio path is the most likely to misbehave on iOS.
- B-Side has a small text overlap around 800px window width.
- Nav links to Explore/History/Saved/Stats/Settings are placeholders in every direction.

# flipside verification map

The maintained source for verifying flipside's user-facing behaviour. Read this index before
driving the app, then use the matching feature file as the recipe. Launch, doctor, evidence and
cleanup are in `../SKILL.md`.

## Baseline preconditions

- `fv launch` printed `READY  app=https://localhost:3947` and `fv doctor` exits 0.
- Drive `https://localhost:3947` only. Never port 3946 (plain HTTP behind the proxy), never port
  3000 (the owner's dev server), never the production site.
- The database starts empty: no users, no artists. Every journey makes its own account through
  `/sign-in` and seeds what it needs with `fv seed <username> feed|history|saved|all`.
- `LASTFM_API_KEY` is not set unless `fv doctor` says so. Without it nothing can generate a feed.

## What the seed contains

`fv seed <username> all` gives that account:

- **feed**: 12 unrated queue cards with real iTunes previews and artwork, in this order: The
  Beatles, The Cure, The Smiths, The Clash, The Kinks, The National, Radiohead, Portishead,
  Massive Attack, Talking Heads, Cocteau Twins, Slowdive. Each reads "Because you like Verify Seed".
- **history**: Joy Division, New Order (Liked); Pixies, Sonic Youth (Passed); Stereolab, Broadcast
  (Skipped); Mogwai (Dismissed); Low (Skipped until the saved seed makes it Saved); then
  `Verify Filler 01` to `55` (Skipped, no artwork), so History has 63 rows and a second page.
- **saved**: Low, Radiohead, Slowdive. Radiohead and Slowdive are also unrated Feed cards.

## Driving conventions

- Run journeys with `python3 .claude/skills/verify-flipside/scripts/journeys.py <name>`; write new
  ones on `scripts/fvdrive.py`. Commands in the feature files are Playwright (Python) calls on
  `p` (the page) unless they start with `fv` or `journeys.py`.
- Roles and accessible names first. Class names appear only where the component offers nothing else.
- Desktop is 1440x900 (`DESKTOP`), phone 390x844 (`PHONE`). The Feed has three layouts; say which
  one a proof used.
- After a navigation wait for real content, not the heading: `/history`, `/saved`, `/settings`
  and `/feed` have loading skeletons that already carry the heading.
- `get_by_role("alert")` also matches Next's empty route announcer. Filter by text.

## Proof and skip reporting

- Capture the action and the resulting state, then the state again after a reload.
- Pair every visible change with the database row (`fv sql` / `r.sql`), noted before and after.
- Record the viewport and the account name with every artifact (`notes.txt` does this).
- A path that cannot run is reported as could-not-run with the unmet precondition. Do not report
  it as verified through a different path.

## Feature entry contract

Each feature file has an H1, one paragraph on the user-visible behaviour, then exactly four H2
sections: `Sub-features`, `How to get to it (user POV)`, `Driving it with Playwright`, `Gotchas`.

## Features

- [Sign-in and account creation](./sign-in.md): the two modes, the no-recovery checkbox, errors, sign-out.
- [Onboarding](./onboarding.md): artist search and picks, Get started, Skip, a failed seeds save.
- [Feed](./feed.md): the queue at phone and desktop widths, More / Less / Skip, Save, preview play state.
- [History](./history.md): filter chips, Return to feed, Load more.
- [Saved](./saved.md): the saved grid and Remove.
- [Settings](./settings.md): sign out and account deletion's confirm dialog; the other panels are mapped, not yet driven.

Not mapped yet: `/stats`, the landing page `/`, the Regenerate dialog, keyboard shortcuts, the
tablet Feed layout, Settings' seeds / genres / "How famous?" editors.

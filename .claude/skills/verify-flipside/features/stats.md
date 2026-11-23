# Stats

Stats summarises what the user has done: four totals (Discovered, Saved, Liked, Passed), top genres
from their likes, and "Your taste profile": a popularity distribution chart and a table of saved and
liked artists that sorts by popularity.
Mapped from the 2026-11-22 sweep scripts, not yet re-driven through this skill.

## Sub-features

- `stats-totals` the `Totals` list shows Discovered, Saved, Liked, Passed counts.
- `stats-genres` `Top genres` lists genres from liked artists, or `No likes yet.`
- `stats-profile` `Your taste profile` has a chart (`img`, named with the artist count and median popularity) and a table of saved and liked artists.
- `stats-sort` the `Popularity` column header button flips the table between lowest first and highest first; `aria-sort` follows.
- `stats-empty` a new account reads `Nothing here yet. Like or save a few artists in the feed.`, all totals 0, `Nothing saved or liked yet.`

## How to get to it (user POV)

- Desktop: `Stats` in the left rail. Phone: `Stats` in the bottom tab bar.
- Open `/stats` directly.

## Driving it with Playwright

Preconditions:

- An onboarded account with `fv seed <name> all` (the sweep's account had been driven before this check and read Discovered 65, Saved 3, Liked 1, Passed 3; a freshly seeded one will differ, so read the expected counts from `saves` and `feedback` first).
- No journey yet. The sweep script was the `# stats` part of `sweep-ui/misc4.py`.

- **Open.** `p.goto(".../stats")`, `networkidle`, then wait for the table: `p.get_by_role("table", name="Saved and liked artists by popularity")`.
- **Totals.** `p.locator("dl").first.inner_text()` reads `Discovered`, a count, `Saved`, `3`, `Liked`, a count, `Passed`, a count.
- **Sort control.** `sort = p.get_by_role("button", name=re.compile("^Popularity"))`; its name is `Popularity, sorted lowest first. Activate to sort highest first.` and `p.get_by_role("columnheader").last` has `aria-sort="ascending"`.
- **Rows.** `[x.inner_text() for x in p.get_by_role("row").all()][1:]`: each reads `<artist> <Saved|Liked> <popularity>`; lowest first, on the sweep's account, read `Low Saved 50`, `Slowdive Saved 64`, `New Order Liked 73`, `Radiohead Saved 85`.
- **Flip.** `sort.click()`: `aria-sort="descending"`, first row `Radiohead Saved 85`. A double-click lands back on `ascending`.
- **Chart.** `p.get_by_role("img").first.get_attribute("aria-label")` reads `Taste profile popularity distribution: <n> artists, median popularity <m>`.
- **Empty.** A fresh account that only skipped onboarding: `p.locator("main").inner_text()` contains `Nothing here yet.`, `No likes yet.`, `Nothing saved or liked yet.`
- **Proof.** Full-page screenshot before and after the sort; the `saves` and `feedback` counts for the user beside the totals.

## Gotchas

- `loading.tsx` already shows the `Stats`, `Top genres` and `Your taste profile` headings; wait for the table or the totals, not a heading.
- The table is an ARIA table built from `div`s and `span`s (`role="table"`, `row`, `columnheader`), not a `<table>`; use roles, not tag selectors.
- The first `row` is the header row; skip it when reading artists.
- An account that skipped onboarding with nothing seeded also triggers the Feed loader's 429 (see onboarding.md); allow it if the journey passes through `/feed`.

# Onboarding

A new account picks what it likes before its first feed: artists (search and pick, at least 3),
genres, a Last.fm or stats.fm username, and where it listens. `Get started` saves the picks and
goes to the Feed; `Skip` goes straight there. Until it is finished, `/feed` sends the user back here.

## Sub-features

- `onb-resume` an unfinished account opening `/feed` lands on `/onboarding`; a finished one opening `/onboarding` lands on `/feed`.
- `onb-search` the `Artists I like` card searches artists and adds picks as chips.
- `onb-min-seeds` with 1 or 2 artists picked `Get started` is disabled and a hint says how many more.
- `onb-disabled-hint` whenever `Get started` is disabled it looks disabled (grey fill and text from the shared `.btn-primary:disabled` style, not violet; default cursor) and a `status` line above it says why: nothing entered yet, 1 or 2 artists, or a malformed Last.fm / stats.fm username. The grey look with nothing entered is driven by `journeys.py disabled-buttons`; the other reasons are mapped, not yet driven.
- `onb-save` `Get started` stores the artists in `seed_artists`, stamps `onboarding_completed_at`, goes to `/feed`.
- `onb-save-fails` when the artists save fails the page stays, shows an error toast and the button works again.
- `onb-skip` `Skip` stamps `onboarding_completed_at` without seeds and goes to `/feed`.

## How to get to it (user POV)

- Create an account on `/sign-in?mode=new`: it lands here.
- Open `/feed` or `/onboarding` with an account that has not finished onboarding.

## Driving it with Playwright

Preconditions:

- A fresh account from `r.sign_up(name)` (ends on `/onboarding`).
- For artist search without Last.fm: run `fv seed <name> feed` first. It creates the `artists` rows the search reads; six of them start with "The ". Reload the page afterwards.
- The failure recipe is `journeys.py onboarding-seeds-fail`.

- **Open artists.** `p.get_by_role("button", name=re.compile("^Artists I like")).click()`. The button has `aria-expanded="true"` and a `Search artists…` field appears.
- **Search.** `p.get_by_placeholder("Search artists…").fill("the ")`. After the 350ms debounce the results list The Beatles, The Cure, The Smiths, The Clash, The Kinks, The National.
- **Pick three.** `p.get_by_role("button", name=re.compile("^The Beatles")).click()`, same for The Cure and The Smiths. Each becomes a chip with a `Remove <name>` button; `p.get_by_role("button", name="Get started")` is enabled from the third.
- **Force the save to fail (browser boundary).** `p.route("**/api/onboarding/seeds", lambda route: route.fulfill(status=500, content_type="application/json", body='{"error":"injected"}'))`, then click `Get started`. `p.get_by_text("Couldn't save your artists. Try again.")` appears, the URL still ends `/onboarding`, the button is enabled and reads `Get started`, `seed_artists` has 0 rows for the user and `onboarding_completed_at` is null.
- **Retry for real.** `p.unroute("**/api/onboarding/seeds")`, click `Get started`, `p.wait_for_url(at("/feed"))`. `seed_artists` has 3 rows and `onboarding_completed_at` is set.
- **Skip.** On a fresh account: `p.get_by_role("button", name="Skip", exact=True).click()`, `p.wait_for_url(at("/feed"))`. `onboarding_completed_at` is set, `seed_artists` is empty.
- **Proof.** Screenshots of the picked chips, the toast, and the feed after retry; `notes.txt` holds the `users` / `seed_artists` state after the failure and after the retry.

## Gotchas

- **Needs `LASTFM_API_KEY` in the launch environment** (export `LASTFM_API_KEY` before `fv launch`) for: searching an artist that is not already in the `artists` table (the search only adds Last.fm results when fewer than 5 rows match), picking such a result (it is resolved through `/api/onboarding/resolve`), the first feed generation that `Get started` and `Skip` kick off, and the `Last.fm history` card's import. Without the key those searches return only table rows and the Feed after onboarding shows "Building your feed" then an error unless rows were seeded.
- Search with a prefix that matches at least 5 seeded artists ("the "). A thinner match asks Last.fm, which answers nothing without a key (no error shown).
- The seeds failure is injected with Playwright `page.route`; the server route itself is not made to fail. That is deliberate: the behaviour under test is the page's reaction. Say so in any report.
- After `Get started` or `Skip` with seeded feed rows the Feed shows them; the background generate request still runs and writes nothing without a key.
- The four path buttons (`Artists I like`, `Genres I love`, `Last.fm history`, `stats.fm history`) start with an icon glyph inside the button (♫, ♪, 📊), so the accessible name of the last three does not begin with the title: `re.compile("^Last.fm history")` matches nothing. Use an unanchored `re.compile("Last.fm history")`. `Artists I like` has an SVG icon and does match `^Artists I like`.
- One click on `Skip` (or `Get started` without artists) sends two `PATCH /api/settings` (the choices, then the completion stamp) and, with nothing seeded, two `POST /api/recommendations/generate`: onboarding's, then the empty Feed loader's, which is answered 429 by design. A double-click sends the same four; that is not a double submit.
- The genre picker loads as a separate chunk when idle or when `Genres I love` opens; wait for its rows, not a fixed sleep. Not driven yet.

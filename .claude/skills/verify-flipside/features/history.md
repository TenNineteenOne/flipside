# History

History lists every artist the user has seen, newest first, with what they did (Liked, Passed,
Skipped, Dismissed, Saved). Filter chips narrow the list, each row can be re-rated or sent back to
the Feed, and older pages load 50 at a time.

## Sub-features

- `hist-list` rows show name, time, popularity and the signal label, grouped by period.
- `hist-filter` the chips All, Liked, Passed, Skipped, Dismissed, Saved filter the loaded rows; counts carry a `+` while older pages remain.
- `hist-return` `Return to feed` (`Allow in feed again` on a Dismissed row) removes the row and makes the artist an unrated Feed card again.
- `hist-change` `Change to Liked` / `Change to Passed` re-rate a row in place.
- `hist-load-more` `Load more` appends the next 50 rows and disappears on the last page.

## How to get to it (user POV)

- Desktop: `History` in the left rail. Phone: `History` in the bottom tab bar.
- Open `/history` directly.

## Driving it with Playwright

Preconditions:

- An onboarded account with `fv seed <name> feed` then `fv seed <name> history` (63 rows; see the README for which artist has which state). Add `fv seed <name> saved` for the Saved chip.
- Journeys: `history-return`, `history-filters`.

- **Open.** `p.get_by_role("navigation", name="Main").get_by_role("link", name=re.compile("^History")).first.click()`, `p.wait_for_url(at("/history"))`. `heading "History"`, 50 rows, the `All` chip reads `All50+`.
- **Find a row.** `row = p.locator("div").filter(has=p.get_by_text("Joy Division", exact=True)).filter(has=p.get_by_role("button")).last`. Its text contains `Liked`.
- **Filter.** `p.get_by_role("button", name=re.compile("^Liked")).first.click()` (chips have `aria-pressed`). Joy Division is listed, Pixies is not. Same for Passed (Pixies), Skipped (Stereolab), Dismissed (Mogwai), Saved (Low).
- **Return a liked row.** `row.get_by_role("button", name="Return to feed").click()`, then `p.get_by_text("Joy Division", exact=True).wait_for(state="detached")`. In the database `recommendation_cache.seen_at` and `skip_at` are null and the `feedback` row has `deleted_at` set.
- **Return a skipped row.** Same on Stereolab. `seen_at` is null; there was and is no feedback row.
- **Allow a dismissed row.** On Mogwai the button is named `Allow in feed again`. `skip_at` and `seen_at` are null afterwards.
- **Reload.** `p.reload()`: none of the three is listed; New Order (untouched) still is.
- **Back in the Feed.** Open `/feed`: `p.get_by_role("list", name="Artist queue").get_by_role("button", name="Select Joy Division")` exists, and selecting it shows `More like this` with `aria-pressed="false"`.
- **Load more.** With the `All` chip: `p.get_by_role("button", name="Load more").click()`, wait for `Verify Filler 55`. 63 rows, and the `Load more` button is gone.
- **Proof.** Screenshots before, after the returns, after the reload, and of the Feed; `notes.txt` holds each artist's row before and after.

## Gotchas

- Rows are plain `div`s with no role or test id; the row locator above is "the innermost div holding the name and a button". An artist name that is a substring of another still works because the text match is exact.
- Row buttons are icon-only and take their accessible name from `title`: `Change to Liked`, `Change to Passed`, `Return to feed`, `Allow in feed again`.
- A Saved row shows the label `Saved` whatever its rating, has no Change buttons, and is counted only under the Saved chip.
- Chip counts cover loaded rows only. The accessible name of a chip includes the count (`Liked2+`), so match the label with a `^Label` regex.
- Returned artists come back with their old score; the seed gives history rows 0.5, below the feed rows, so they appear at the end of the queue. The Feed loads at most 20 unrated cards.
- `Return to feed` on a rated row sends two requests (`DELETE /api/feedback/<id>`, then `DELETE /api/dismiss/<id>`); wait for the row to detach, not for the first response.
- Period labels (Today, Yesterday) appear only after hydration; do not assert on them straight after load.

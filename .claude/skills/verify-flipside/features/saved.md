# Saved

Saved is the grid of artists the user bookmarked, newest first, each with artwork, genres, an
open-in-platform link, a copy-link button and Remove.

## Sub-features

- `saved-list` every save is a card; the header reads `<n> artists`.
- `saved-remove` `Remove <name>` unsaves at once and the card leaves.
- `saved-empty` with nothing saved: "Nothing saved yet." and a `Go to your feed` link.
- `saved-open` each card links out to the user's music platform (`Open in <platform>`); `Copy link` copies the artist link.

## How to get to it (user POV)

- Desktop: `Saved` in the left rail. Phone: `Saved` in the bottom tab bar.
- From the Feed's end state: `Review saved`.
- Open `/saved` directly.

## Driving it with Playwright

Preconditions:

- An onboarded account with `fv seed <name> feed`, `fv seed <name> history`, `fv seed <name> saved` (Low, Radiohead, Slowdive).
- Journey: `saved`.

- **Open.** `p.get_by_role("navigation", name="Main").get_by_role("link", name=re.compile("^Saved")).first.click()`, `p.wait_for_url(at("/saved"))`, then wait for `p.get_by_text("3 artists", exact=True)`.
- **Cards.** `p.get_by_role("button", name="Remove Low")`, `Remove Radiohead`, `Remove Slowdive` each exist once.
- **Remove.** `p.get_by_role("button", name="Remove Low").click()` (wait for `DELETE /api/saves`). The header reads `2 artists`, the button is gone, `saves` has 2 rows for the user.
- **Reload.** `p.reload()`, wait for `2 artists`: Low is still gone.
- **Empty state.** Remove the rest: `Nothing saved yet.` and `p.get_by_role("link", name="Go to your feed")`. Not scripted yet.
- **Proof.** Screenshot before and after the reload; the `saves` count in `result.txt`.

## Gotchas

- The route's loading skeleton already shows the `Saved` heading. Wait for the `<n> artists` text.
- `Open in <platform>` and `Copy link` are identified by `title`. Copy link needs clipboard permission in the browser context (`ctx.grant_permissions(["clipboard-read", "clipboard-write"])`); not driven yet.
- With the default platform (Spotify) a seeded artist has no Spotify id, so its open link may be a search or absent. Not driven yet; check `lib/music-links.ts` before asserting on the URL.
- Saving from the Feed is in [feed.md](./feed.md); a save also marks the artist seen.

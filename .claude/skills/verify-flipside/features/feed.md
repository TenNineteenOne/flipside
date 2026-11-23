# Feed

The Feed ("Today's flipside") is the queue of recommended artists. Each card has artwork, why it
was picked, three decisions (Less, Skip, More), Save, an open-in-platform link, Share and up to
three 30-second previews. Desktop shows a queue list beside a focus pane; phones show one
full-height card per artist in a vertical snap scroller.

## Sub-features

- `feed-render` a seeded queue renders at 390px and 1440px with no console errors, CSP violations, broken images or horizontal overflow.
- `feed-more` More like this stores a thumbs-up, tags the row Liked, keeps it in the queue and selects the next artist.
- `feed-less` Less like this stores a thumbs-down and the row leaves the queue.
- `feed-skip` Skip stamps `skip_at` (History calls it Dismissed) and the row leaves the queue.
- `feed-save` Save stores a `saves` row and the button reads Saved (pressed); one more tap unsaves.
- `feed-saved-on-load` an unrated card whose artist is already saved reads Saved on a fresh page load.
- `feed-preview` a preview row's button turns from `Play <track>` to `Pause <track>` while it plays, and back.
- `feed-landscape` on a phone held sideways (844x390) the preview rows are hidden and the artwork is a button: `Play <artist> preview` starts the first preview, `Pause <artist> preview` pauses it (#214). Not shown in portrait.
- `feed-persist` after a reload, decided artists are gone from the queue and listed in History.

## How to get to it (user POV)

- Sign in: an onboarded account lands on `/feed`.
- Desktop: `Feed` in the left rail (`navigation "Main"`). Phone: `Feed` in the bottom tab bar, or the wordmark.
- `/explore` redirects here.

## Driving it with Playwright

Preconditions:

- An account that finished onboarding, with `fv seed <name> feed` run before `/feed` was opened (12 unrated cards, The Beatles first).
- Desktop recipes below use 1440x900. Journeys: `feed-render`, `feed-triage`, `feed-save`.

- **Queue (desktop).** `queue = p.get_by_role("list", name="Artist queue")`; `queue.get_by_role("listitem")` counts 12. `pane = p.get_by_role("region", name="Selected artist")` shows `heading "The Beatles"`.
- **Cards (phone, 390x844).** `p.get_by_role("article")` counts 12 and `p.get_by_role("heading", name="The Beatles")` is visible; `navigation "Main"` is the bottom tab bar.
- **Clean console.** Note `len(r.console)` before `p.goto(".../feed")`, wait for `networkidle` plus 3s, then `r.problems()` restricted to the lines after the mark is empty. Also assert `[...document.images].filter(i => i.complete && i.naturalWidth === 0)` is empty.
- **Select.** `p.get_by_role("button", name="Select The Cure").click()`; the pane's heading becomes The Cure.
- **More.** `pane.get_by_role("button", name="More like this").click()` (wait for the `POST /api/feedback` response). The pane moves to the next artist, the row keeps a `Liked` tag, `feedback.signal = thumbs_up` and `recommendation_cache.seen_at` is set.
- **Less.** `pane.get_by_role("button", name="Less like this").click()`. The row leaves the queue; `feedback.signal = thumbs_down`.
- **Skip.** `pane.get_by_role("button", name="Skip this artist").click()`. The row leaves; `skip_at` is set and there is no feedback row.
- **Save.** `pane.get_by_role("button", name="Save for later").click()` (wait for `POST /api/saves`). The button is now named `Saved` with `aria-pressed="true"`, the row shows a `Saved` tag, a `saves` row exists.
- **Unsave.** `pane.get_by_role("button", name="Saved").click()` once. A `DELETE /api/saves` goes out, the button is `Save for later` again, the `saves` row is gone.
- **Preview.** `pane.get_by_role("button", name="Play Hey Jude").click()`. Within a few seconds the button is named `Pause Hey Jude`, the queue row's art button is `Pause The Beatles`, and `.ev-track-bar > span` has a `scaleX` above 0 (audio is advancing). Click it: back to `Play Hey Jude`.
- **Landscape phone (844x390, `Run(..., viewport=LANDSCAPE, mobile=True)`).** `card = p.get_by_role("article").first`; `card.get_by_role("button", name="Play The Beatles preview").tap()`. The button becomes `Pause The Beatles preview`, the player bar above the tab bar shows Hey Jude and `.ev-player-bar > span` has a `scaleX` above 0. Tap again: `Play …` and the bar stops. Journey: `feed-landscape` (also asserts the button is absent at 390x844).
- **Persistence.** `p.reload()`: decided artists are not in the queue. `/history` lists them as Liked, Passed, Dismissed.
- **Proof.** Screenshot at each viewport with the viewport in the file name; `notes.txt` holds the `recommendation_cache` / `feedback` / `saves` row before and after each tap.

## Gotchas

- **Needs `LASTFM_API_KEY` in the launch environment** (export `LASTFM_API_KEY` before `fv launch`) for everything that builds a feed: the empty-queue "Building your feed" loader, `Regenerate`, and the background top-up that starts when fewer than 8 unrated cards are loaded. Seeded rows cover rendering and triage only; nothing here proves the engine.
- **Saving marks the artist as seen.** `POST /api/saves` stamps `recommendation_cache.seen_at`, so after a reload a card that was saved without a rating is no longer in the Feed (it is in History, labelled Saved). `feed-saved-on-load` is therefore only reachable when a `saves` row exists for an artist whose `seen_at` is null: History > `Return to feed` on a Saved row, or the seed (Radiohead and Slowdive after `fv seed <name> all`). `journeys.py feed-save` records this as a FAIL on the "still a Feed card after reload" line as of commit 3084bea; that line is the product finding, not a broken journey.
- A second advancing decision on a different artist within 350ms of the last one is ignored by design. Wait for the pane's heading to change before the next tap.
- Skip in the Feed is History's "Dismissed", not "Skipped". "Skipped" is a seen row with no rating.
- Passed and dismissed rows animate out; wait about half a second before asserting they are gone.
- The preview audio element is created with `new Audio()` and is not in the DOM. Read play state from the button names and the progress bar.
- Previews and artwork are real iTunes URLs fetched at seed time. With no network at first seed, cards have no previews and the Feed drops them (the seed prints a WARNING and exits 3).
- The weekly challenge strip is created on first Feed load (a `user_challenges` row); its text depends on the calendar week.
- The artwork play button exists only where the rows are hidden: a Snap page under 410px tall, or 560px and wider and under 290px tall. At 932x430 the page is tall enough for the rows, so there is no artwork button there.
- The tablet layout (640 to 899px wide, at least 680px tall) is not driven yet.

# Keyboard shortcuts

The desktop Feed can be driven from the keyboard: move through the queue, play previews, rate,
save, share, open, undo, and open a sheet that lists the keys. Keys do nothing while a dialog is open.
Mapped from the 2026-11-22 sweep scripts, not yet re-driven through this skill.

## Sub-features

- `kb-move` `j` / `ArrowDown` selects the next artist, `k` / `ArrowUp` the previous one.
- `kb-play` `Space` plays or pauses the selected artist's preview; `1`, `2`, `3` play that track.
- `kb-rate` `l` (and `Shift+L`) is More like this, `x` is Less like this; each shows a toast with `Undo Z`, and `z` undoes it.
- `kb-save` `b` saves, `b` again unsaves (toasts `Saved <artist>`, `Removed <artist> from Saved`).
- `kb-share-open` `s` copies the artist link (toast `Link to <artist> copied`); `o` opens it in a new tab.
- `kb-sheet` `?` opens the `Keyboard shortcuts` sheet and closes it again; `Escape` closes it; the rail's `Keyboard shortcuts` button opens it too.
- `kb-guard` with the sheet or the Regenerate dialog open, letter keys do nothing; `Ctrl` / `Meta` combinations never trigger a shortcut; a held key acts once.

## How to get to it (user POV)

- Desktop Feed (at least 900px wide), with focus on the page and not in a text field.
- The list of keys: press `?`, or the `Keyboard shortcuts` button at the bottom of the left rail.

## Driving it with Playwright

Preconditions:

- An onboarded account with `fv seed <name> feed`, at 1440x900, on `/feed` after `networkidle`.
- No journey yet. The sweep script was `sweep-ui/kb.py`.

- **Handles.** `pane = p.get_by_role("region", name="Selected artist")`, `queue = p.get_by_role("list", name="Artist queue")`; the selected artist is `pane.get_by_role("heading").first.inner_text()`.
- **Move.** `p.keyboard.press("j")` twice: The Cure, then The Smiths. `k`: The Cure. `ArrowDown` / `ArrowUp` do the same.
- **Play.** `p.keyboard.press("Space")`: buttons named `Pause The Cure` and `Pause Just Like Heaven` exist. `2`: `Pause Pictures of You`. `Space`: no `Pause …` button remains.
- **Rate and undo.** `l`: selection moves to The Smiths, a toast reads `More like The Cure` with `Undo` `Z`, the queue still has 12 rows. `z`: selection back on The Cure, toast gone. `x`: 11 rows, toast `Less like The Cure`; `z` restores 12.
- **Save.** `b`: toast `Saved The Cure`; `b`: toast `Removed The Cure from Saved`.
- **Sheet.** `p.keyboard.press("?")`: `dialog[open]` with class `ev-sheet`, heading `Keyboard shortcuts`, focus on its `Close` button. `l` now changes nothing. `Escape` closes it. `p.get_by_role("button", name="Keyboard shortcuts").click()` opens it again; `?` closes it and focus returns to that rail button.
- **Regenerate dialog.** Focus `.ev-wander-ctl .ev-regen`, press `Enter`: `dialog[open].ev-regen-dialog` with focus on `Cancel`. Letter keys do nothing. `Escape` closes it and focus returns to `Regenerate`.
- **Share and open.** `r.ctx.grant_permissions(["clipboard-read", "clipboard-write"])`, `s`: toast `Link to The Cure copied`, clipboard holds the platform link. `with r.ctx.expect_page() as np: p.keyboard.press("o")`: the new tab's URL is the same link.
- **Proof.** Screenshot of the sheet and of the Regenerate dialog; note the selected artist, row count and toast text after each key; database rows for `l`, `x`, `b` as in feed.md.

## Gotchas

- The rail button's accessible name is `Keyboard shortcuts`; "Shortcuts" is only its tooltip, so `name="Shortcuts"` with `exact=True` finds nothing.
- Without clipboard permission `s` (or `Space` on the focused `Share` button) shows `Couldn't copy link`. Grant the permission first.
- `Space` on a focused button activates that button; it does not toggle the preview.
- Wait about half a second after a rating key before reading the queue: rows animate out, and a second advancing decision within 350ms is ignored.
- With the default platform and a seeded artist, the link is a Spotify search URL (`https://open.spotify.com/search/The%20Cure`).
- The dismiss key was only pressed inside the Regenerate dialog during the sweep (where it must do nothing); read `components/feed/feed-shortcuts.tsx` for the full key list before asserting on it.

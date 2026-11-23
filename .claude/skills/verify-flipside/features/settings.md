# Settings

Settings holds the account actions (Sign out, Forget my account permanently) and the preference
panels: Profile, Where do you listen?, Connected sources (Last.fm, stats.fm), Seeds and Discovery
("How famous?").

## Sub-features

- `set-signout` Sign out ends the session and goes to `/`.
- `set-delete-confirm` Forget my account permanently asks through the browser's confirm dialog; one click alone deletes nothing.
- `set-delete-dismiss` dismissing the dialog keeps the account and sends no request.
- `set-delete-accept` accepting deletes the `users` row and everything under it, signs out and goes to `/`.
- `set-platform` the `Preferred music platform` radio group saves the platform. Mapped, not yet driven.
- `set-sources` Last.fm / stats.fm usernames and `Sync now`. Mapped, not yet driven.
- `set-seeds`, `set-fame` the seed artist / genre editor and the `How famous?` slider. Mapped, not yet driven.

## How to get to it (user POV)

- Desktop: `Settings` in the left rail.
- Phone: the avatar button `Account and settings` in the top bar, then `Settings`.
- Open `/settings` directly.

## Driving it with Playwright

Preconditions:

- An onboarded account (seeded or not). Deleting it is final: use an account made for this journey.
- Journey: `settings-delete`.

- **Open.** `p.goto(".../settings")`, wait for `p.get_by_role("button", name="Forget my account permanently")`.
- **Click and dismiss.** `r.dialog_action = "dismiss"`, click the button. `r.dialogs` is exactly `["confirm: Permanently delete your account? This cannot be undone."]`, the URL still ends `/settings`, the button is enabled, no `DELETE .../api/account` is in `r.requests`, and the `users` row is still there.
- **Click and accept.** `r.dialog_action = "accept"`, click again (wait for the `DELETE /api/account` response: 200 with `{"success":true}` and the cleared session cookie), then `p.wait_for_url("https://localhost:3947/")`. The `users` row is gone, the user's `recommendation_cache` rows are gone, no `__Secure-authjs.session-token` cookie remains, and `/settings` redirects to `/sign-in`.
- **Sign out.** `p.get_by_role("button", name="Sign out").click()`, `p.wait_for_url("https://localhost:3947/")`. Covered by `journeys.py signin`.
- **Platform (not yet driven).** `p.get_by_role("radiogroup", name="Preferred music platform")` holds `radio` items with `aria-checked`; the saved value is `users.preferred_music_platform`.
- **Fame (not yet driven).** `p.get_by_label("How famous?")`; saves 400ms after the last change to `users.fame_level` (0 to 4). Keyboard focus shows a 2px outline.
- **Sources (not yet driven).** `p.get_by_role("textbox", name="Last.fm username")` and `name="stats.fm username"`. A changed value saves on blur or on Enter (Enter blurs the field): one `PATCH /api/settings`, then the status line reads `connected · @<name>`.
- **Seeds (not yet driven).** `Artists` and `Genres` are collapsed buttons (`aria-expanded`). Adds and removes of one artist reach the server in tap order; a failed genre save puts the selection back to the last saved list.
- **Proof.** Screenshots of Settings, after the dismiss, and the landing page after deletion; `console.log` has both dialog lines; `result.txt` has the row counts.

## Gotchas

- Playwright dismisses a dialog that nobody handles, silently. `Run` records every dialog; always assert on `r.dialogs`, or a missing confirm looks the same as a dismissed one.
- `DELETE /api/account` answers 200 (no redirect) and clears the session cookie; the page then navigates to `/` itself. `settings-delete` asserts the 200, that no `DELETE https://localhost:3947/` request exists, and (like every journey) that `r.problems()` is empty. Until 2026-11-22 the route answered 307, the page's `fetch` replayed the DELETE against `/` and every deletion logged a 405 that this journey did not look for.
- Never drive port 3946 directly: the production CSP carries `upgrade-insecure-requests`, and the session cookie and CSRF origin differ over plain HTTP.
- **Needs `LASTFM_API_KEY` in the launch environment** (export `LASTFM_API_KEY` before `fv launch`) for Connected sources > Last.fm `Sync now`. stats.fm sync calls stats.fm and needs a real stats.fm username.
- Changing genres in Seeds wipes the unrated Feed queue (by design); do not run it in the middle of a Feed journey.

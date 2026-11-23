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
- **Click and accept.** `r.dialog_action = "accept"`, click again (wait for the `DELETE /api/account` response, a 307), then `p.wait_for_url("https://localhost:3947/")`. The `users` row is gone, the user's `recommendation_cache` rows are gone, no `__Secure-authjs.session-token` cookie remains, and `/settings` redirects to `/sign-in`.
- **Sign out.** `p.get_by_role("button", name="Sign out").click()`, `p.wait_for_url("https://localhost:3947/")`. Covered by `journeys.py signin`.
- **Platform (not yet driven).** `p.get_by_role("radiogroup", name="Preferred music platform")` holds `radio` items with `aria-checked`; the saved value is `users.preferred_music_platform`.
- **Fame (not yet driven).** `p.get_by_label("How famous?")`; saves 400ms after the last change to `users.fame_level` (0 to 4).
- **Proof.** Screenshots of Settings, after the dismiss, and the landing page after deletion; `console.log` has both dialog lines; `result.txt` has the row counts.

## Gotchas

- Playwright dismisses a dialog that nobody handles, silently. `Run` records every dialog; always assert on `r.dialogs`, or a missing confirm looks the same as a dismissed one.
- `DELETE /api/account` answers with a redirect that the page's `fetch` follows. Over plain HTTP the production CSP (`upgrade-insecure-requests`) turns that redirect into `https://` and the fetch fails: the account is deleted but the page shows "Failed to delete account" and stays. This is why the stand-in serves HTTPS; never drive port 3946 directly.
- **Needs `LASTFM_API_KEY` in the launch environment** (export `LASTFM_API_KEY` before `fv launch`) for Connected sources > Last.fm `Sync now`. stats.fm sync calls stats.fm and needs a real stats.fm username.
- Changing genres in Seeds wipes the unrated Feed queue (by design); do not run it in the middle of a Feed journey.

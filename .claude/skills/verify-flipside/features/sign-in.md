# Sign-in and account creation

A user signs in with a username only. The page has two modes: Existing account (the default, never
creates anything) and New account (shows the username rule and a no-recovery checkbox that gates
Create account). A new account goes on to onboarding; an existing one goes to the page it came from.

## Sub-features

- `signin-default-mode` opens in Existing account; `/sign-in?mode=new` opens in New account.
- `signin-unknown` Existing mode with an unknown name shows one generic error and creates no row.
- `signin-create` New mode creates the account once the checkbox is ticked, and lands on `/onboarding`.
- `signin-taken` New mode with a name that exists says it is taken.
- `signin-disabled-look` a disabled submit button (Create account before the checkbox; either button with no name typed) is grey, the enabled one violet `rgb(139, 92, 246)`. Journey `disabled-buttons` compares the computed backgrounds (wait 400ms after enabling: the colour is a 180ms transition) and screenshots both states. The app has one dark theme; an OS light setting changes nothing.
- `signin-return` an existing account signs in and returns to the `?from=` page.
- `signout` Sign out clears the session; protected pages then redirect to `/sign-in?from=...`.

## How to get to it (user POV)

- Open `https://localhost:3947/sign-in` (Existing account) or `/sign-in?mode=new` (New account).
- From the landing page `/`, choose its call to action (opens `?mode=new`).
- Open any protected page while signed out, e.g. `/settings`: it redirects to `/sign-in?from=%2Fsettings`.
- Sign out: Settings > `Sign out`, or on phone widths the avatar button `Account and settings` > `Sign out`.

## Driving it with Playwright

Preconditions:

- `fv doctor` exits 0. The username you pick does not exist yet.
- The whole recipe is `journeys.py signin`.

- **Default mode.** `p.goto(".../sign-in")`. `p.get_by_role("button", name="Existing account")` has `aria-pressed="true"`.
- **Unknown name.** `p.get_by_role("textbox", name="Username").fill(name)`, then `p.get_by_role("button", name="Sign in", exact=True).click()`. `p.get_by_role("alert").filter(has_text=re.compile("."))` reads `Couldn’t sign in with that username. New here? Choose New account.` and `select count(*) from users` is unchanged.
- **Switch to New.** `p.get_by_role("button", name="New account").click()`. `p.get_by_role("button", name="Create account")` is disabled.
- **Acknowledge.** `p.get_by_role("checkbox", name="I understand my username cannot be recovered if I forget it.").check()`. Create account becomes enabled.
- **Create.** Click `Create account`, then `p.wait_for_url(at("/onboarding"))`. The newest `users` row has a `username_hash`, never the typed name, and `onboarding_completed_at` is null.
- **Sign out.** On `/settings`, `p.get_by_role("button", name="Sign out").click()`, then `p.wait_for_url("https://localhost:3947/")`. No cookie named `__Secure-authjs.session-token` remains; `/settings` now redirects to `/sign-in?from=%2Fsettings`.
- **Taken name.** New account + same name + checkbox + `Create account`. The alert contains `That username is taken`.
- **Sign in again.** `Existing account`, `Sign in`. `p.wait_for_url(at("/settings"))` (the `?from=` page). The users count is still one more than at the start.
- **Proof.** `r.shot(...)` after each step; `notes.txt` holds the `users` row.

## Gotchas

- `get_by_label("Username")` matches two elements in New mode (the textbox and the checkbox, whose label text contains "username"). Use the textbox role.
- The input strips anything outside `a-z 0-9 . _ -` as you type and caps at 30 characters; assert on what the field holds, not on what you sent.
- Sign-in is rate limited to 10 attempts per minute per IP, and locally every attempt is one IP. `journeys.py` runs `delete from login_attempts` between journeys; a hand-written run that signs in more than 10 times a minute gets "Too many attempts".
- Await `/settings` with `at("/settings")` (from `fvdrive`), not `"**/settings"`: the glob also matches `/sign-in?from=/settings`, the page the browser is already on, so `signin-return` would pass without any navigation.
- A signed-in browser that opens `/sign-in` is redirected to `/feed`. Sign out first, or use a fresh `Run`.
- The session cookie is `__Secure-authjs.session-token` here because the stand-in serves HTTPS. On plain HTTP it would be `authjs.session-token`.

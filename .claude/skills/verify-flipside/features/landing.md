# Landing page

Signed-out visitors to `/` get the landing page: a hero with a real playable artist card (preview,
Less like this, More like this), calls to action, and a username field that hands over to account
creation. No account or database row is involved until sign-in.
Mapped from the 2026-11-22 sweep scripts, not yet re-driven through this skill.

## Sub-features

- `land-handoff` typing a name in `Your name on flipside` and pressing Enter opens `/sign-in?username=<name>&mode=new` in New account mode with the name filled in (lower-cased).
- `land-empty` submitting the field empty stays on `/`.
- `land-play` the hero's `Play <artist>` button plays a preview and becomes `Pause <artist>`; the track row shows elapsed time `of` the track length.
- `land-verdict` `More like this` / `Less like this` on the hero moves to the next sample artist.
- `land-cta` `Start listening` goes to account creation, `Sign in` to sign-in. Seen, not clicked, in the sweep.
- `land-redirects` signed out, `/feed` and `/explore` land on `/`; other app pages land on `/sign-in?from=…`.

## How to get to it (user POV)

- Open `https://localhost:3947/` while signed out (a fresh `Run`, or after Sign out).
- Signed in, `/` still shows the landing page (it does not redirect to the Feed).

## Driving it with Playwright

Preconditions:

- `fv doctor` exits 0. No account or seed needed; the hero's artists are bundled sample data with real preview URLs (network needed to play).
- No journey yet. The sweep script was the first part of `sweep-ui/signin.py`.

- **Open.** `p.goto(r.url("/"))`, `networkidle`. Visible buttons include `Play <artist>`, `Less like this`, `More like this`; links `Start listening` and `Sign in`.
- **Hand-off.** `f = p.get_by_label("Your name on flipside")`, `f.fill("Sweep.Land_1")`, `f.press("Enter")`. The URL is `/sign-in?username=Sweep.Land_1&mode=new`, `p.get_by_role("button", name="New account")` has `aria-pressed="true"`, and `p.get_by_role("textbox", name="Username")` holds `sweep.land_1`.
- **Empty submit.** `f.fill("")`, `f.press("Enter")`: the URL is still `/`.
- **Play.** `p.locator("button[aria-label^='Play']").first.click()`; after about 2s a button named `Pause <artist>` exists and the track row reads like `0:02 of 3:21`.
- **Verdicts.** `p.get_by_role("button", name=re.compile("More like this")).first.click()` repeatedly (wait 700ms between): `p.locator(".ev-landing").inner_text()` shows a different artist each time.
- **Redirects.** `p.goto(r.url("/feed"))` ends on `/`; `p.goto(r.url("/history"))` ends on `/sign-in?from=%2Fhistory`.
- **Proof.** Screenshot of the hero, the hero playing, and the sign-in page after the hand-off.

## Gotchas

- The sample artist shown first can change when the bundled sample changes (the sweep saw Glass Beams, then YĪN YĪN after a few verdicts); match `^Play ` and read the name, do not hard-code it.
- The hand-off keeps the typed casing in the URL; the sign-in field lower-cases it and strips characters outside `a-z 0-9 . _ -`.
- Landing verdicts are local to the page: no request, no row. Do not look for `feedback` rows.
- `Start listening` and `Sign in` each appear more than once (header links, the hero call to action, and the submit buttons beside the username field); use `.first` or scope the locator.
- `.ev-landing` is a class selector, used because the hero has no landmark name.

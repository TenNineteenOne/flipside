# Mini player and audio across pages

A preview started in the Feed keeps playing when the user moves to History, Saved or Stats, where a
pill at the bottom of the screen shows the track, its progress and Play / Pause. Back on the Feed
the pill is gone and the card (and the desktop's docked player bar) carries the same state.
Mapped from the 2026-11-22 sweep scripts, not yet re-driven through this skill.

## Sub-features

- `player-carry` a playing preview keeps playing across a client-side navigation away from the Feed.
- `player-pill` off the Feed a pill shows `<track>` and `<artist>`, a progress bar and one `Pause` / `Play` button, plus `Close player`.
- `player-pill-pause` pausing from the pill pauses the audio; the pill stays through further page changes.
- `player-return` back on the Feed there is no pill; the card's track button reads `Play <track>` (paused) or `Pause <track>`, and one click resumes from the same position.
- `player-switch` clicking a second track right after the first leaves exactly one playing (the second).
- `player-docked` desktop Feed only: a docked bar (`.ev-player`) shows the track and artist with its own `Pause` / `Play`.

## How to get to it (user POV)

- On the Feed, tap a preview row (`Play <track>`), then use the nav (`History`, `Saved`, `Stats`).
- Same at phone (390x844) and desktop (1440x900) widths; only the Feed side differs.

## Driving it with Playwright

Preconditions:

- An onboarded account with `fv seed <name> feed` (The Beatles first; its tracks include Hey Jude, Here Comes the Sun, In My Life).
- No journey yet. The sweep script was `sweep-ui/audio.py`.

- **Scope.** Desktop: `scope = p.get_by_role("region", name="Selected artist")`. Phone: `scope = p.get_by_role("article").first`.
- **Play.** `scope.get_by_role("button", name="Play Hey Jude").click()`, then wait for `scope.get_by_role("button", name="Pause Hey Jude")`. Desktop also shows `Pause The Beatles` on the queue row and `.ev-player` reading `Hey Jude` / `The Beatles`.
- **Leave the Feed.** `p.get_by_role("navigation", name="Main").get_by_role("link", name=re.compile("^History")).first.click()`, `p.wait_for_url(at("/history"))`. `pill = p.locator(".mini-player-pill")` exists with `data-state="open"` and text `Hey Jude`, `The Beatles`; its bar (`.h-full`) has a growing `width`.
- **Pause from the pill.** `pill.get_by_role("button", name="Pause").click()`; the button is now `Play` and the bar stops. Go on to `Saved` and `Stats` the same way: the pill is still there, still paused, same width.
- **Return.** Nav `Feed`, `p.wait_for_url(at("/feed"))`: `.mini-player-pill` is gone, the card button reads `Play Hey Jude`, and the progress bar (`.ev-track-bar > span`) keeps its `scaleX`. Click it: `Pause Hey Jude` and the bar advances from there.
- **Second track.** `Play Hey Jude` then at once `Play Here Comes the Sun`: after 3s only `Pause Here Comes the Sun` exists.
- **Reading the audio itself.** The element is not in the DOM. Before the first navigation add an init script that wraps `window.Audio` and keeps each instance in `window.__audios`, then read `paused`, `currentTime`, `ended`, `error` with `p.evaluate`.
- **Proof.** Screenshot playing on the Feed, the pill on History, the pill paused on Stats, and the Feed after returning; note the audio's `currentTime` at each step.

## Gotchas

- The sweep launched Chromium with `--autoplay-policy=no-user-gesture-required`; `Run` does not. `feed-triage` plays a preview by click without it, but resuming after a navigation has not been tried under `Run`'s default.
- A full page load (`p.goto`, `p.reload`) drops the audio; only nav-link clicks carry it.
- The pill's buttons are named just `Pause` / `Play`; scope them to `.mini-player-pill`, because the Feed's own buttons also start with those words.
- Playing to the natural end: seek with `a.currentTime = a.duration - 2` on the captured element, then wait 4s. Afterwards the sweep saw a single `Play` button and no `Pause`.
- Offline (`r.ctx.set_offline(True)`) playback of an unloaded track logs `net::ERR_INTERNET_DISCONNECTED` request failures: allow them in `r.passed(allow=...)` if a journey does this on purpose.

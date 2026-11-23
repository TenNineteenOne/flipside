#!/usr/bin/env python3
"""Scripted journeys for verify-flipside. Each one drives the real UI in headless Chromium against
the instance `fv launch` started, checks the database alongside the screen, and writes evidence to
~/.cache/flipside-verify/evidence/<journey>-<HHMMSS>/ (result.txt, notes.txt, console.log, PNGs;
set FLIPSIDE_VERIFY_EVIDENCE to put them somewhere else).

    journeys.py list
    journeys.py <name> [<name> ...]      # exit code 1 if any expectation failed
    journeys.py all

Each journey creates its own account through /sign-in (name printed in notes.txt), so they do not
share state and can run in any order. Read the matching features/*.md before trusting a result.

Every journey ends with `return r.passed(allow=...)`: any console error, page error or failed request
it collected fails it unless a substring on that journey's allowlist explains it.
"""
import re
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ inside the repo
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fvdrive import DESKTOP, PHONE, Run, at  # noqa: E402

STAMP = time.strftime("%H%M%S")


def user(tag: str) -> str:
    return f"v-{tag}-{STAMP}"


def db_state(r: Run, username_uid: str, artist: str) -> str:
    """The cache row and feedback row for one artist, as JSON lines."""
    return r.sql(f"""
      select a.name, rc.seen_at, rc.skip_at, f.signal as feedback_signal, f.deleted_at as feedback_deleted_at,
             (select count(*)::int from saves s where s.user_id = rc.user_id and s.artist_id = a.id) as saves
      from recommendation_cache rc join artists a on a.id = rc.artist_id
      left join feedback f on f.user_id = rc.user_id and f.artist_id = a.id
      where rc.user_id = '{username_uid}' and a.name = '{artist}'""")


def uid(r: Run) -> str:
    """Id of the newest account (the one this journey just created)."""
    m = re.search(r'"id":"([0-9a-f-]+)"', r.sql("select id from users order by created_at desc limit 1"))
    return m.group(1) if m else ""


def new_account_with(r: Run, tag: str, seed: str | None) -> tuple[str, str]:
    """Sign up, optionally seed, leave onboarding by its Skip button. Ends on /feed."""
    name = user(tag)
    r.sign_up(name)
    u = uid(r)
    r.note("account", f"username={name} id={u}")
    if seed:
        r.seed(name, seed)
    r.skip_onboarding()
    return name, u


# --------------------------------------------------------------------------------------------
def signin():
    """Account creation and sign-in through /sign-in (features/sign-in.md)."""
    with Run(f"signin-{STAMP}") as r:
        p, name = r.page, user("signin")
        users = lambda: int(re.search(r'"n":(\d+)', r.sql("select count(*)::int as n from users")).group(1))
        n0 = users()
        p.goto(r.url("/sign-in"))
        r.expect(p.get_by_role("button", name="Existing account").get_attribute("aria-pressed") == "true",
                 "sign-in opens in Existing account mode")
        p.get_by_role("textbox", name="Username").fill(name)
        p.get_by_role("button", name="Sign in", exact=True).click()
        err = p.get_by_role("alert").filter(has_text=re.compile("."))   # Next's empty route announcer is also role=alert
        err.wait_for()
        r.expect("Couldn’t sign in with that username. New here? Choose New account." == err.inner_text(),
                 "Existing mode with an unknown name shows the generic error and creates nothing")
        r.expect(users() == n0, "DB: no users row was created by the failed sign-in")
        r.shot("existing-unknown-name")

        p.get_by_role("button", name="New account").click()
        create = p.get_by_role("button", name="Create account")
        r.expect(create.is_disabled(), "Create account is disabled until the no-recovery box is ticked")
        p.get_by_role("checkbox", name="I understand my username cannot be recovered if I forget it.").check()
        r.shot("new-account-ready")
        create.click()
        p.wait_for_url(at("/onboarding"), timeout=20000)
        r.expect(True, "new account lands on /onboarding (via /feed's resume redirect)")
        row = r.sql("select id, username_hash, onboarding_completed_at from users order by created_at desc limit 1")
        r.note("users after sign-up", row)
        r.expect(users() == n0 + 1 and name not in row, "DB: exactly one new users row, username stored only as a hash")
        r.shot("onboarding-after-signup")

        p.get_by_role("button", name="Skip", exact=True).click()
        p.wait_for_url(at("/feed"), timeout=20000)
        r.expect("onboarding_completed_at\":\"" in r.sql("select onboarding_completed_at from users order by created_at desc limit 1"), "DB: Skip stamped onboarding_completed_at")

        # Sign out from Settings, then the same name again in each mode.
        p.goto(r.url("/settings"))
        p.get_by_role("button", name="Sign out").click()
        p.wait_for_url(r.url("/"), timeout=20000)
        r.expect(not any(c["name"].endswith("authjs.session-token") for c in r.ctx.cookies()), "sign out clears the session cookie")
        p.goto(r.url("/settings"))
        r.expect("/sign-in?from=%2Fsettings" in p.url, "signed out: /settings redirects to /sign-in?from=/settings")
        p.get_by_role("button", name="New account").click()
        p.get_by_role("textbox", name="Username").fill(name)
        p.get_by_role("checkbox", name="I understand my username cannot be recovered if I forget it.").check()
        p.get_by_role("button", name="Create account").click()
        err.wait_for()
        r.expect("That username is taken" in err.inner_text(), "New mode with a taken name says it is taken")
        r.shot("taken")
        p.get_by_role("button", name="Existing account").click()
        p.get_by_role("button", name="Sign in", exact=True).click()
        p.wait_for_url(at("/settings"), timeout=20000)
        r.expect(True, "existing account signs in and returns to the ?from= page (/settings)")
        r.expect(users() == n0 + 1, "DB: still exactly one users row for this name")
        r.shot("signed-in-again")
        # Skip with nothing seeded: onboarding starts generation, then the empty Feed's loader asks again
        # inside the cooldown and gets a 429 by design (it polls instead).
        return r.passed(allow=("429 (Too Many Requests)  (https://localhost:3947/api/recommendations/generate)",))


def _feed_render(viewport, label):
    with Run(f"feed-render-{label}-{STAMP}", viewport=viewport) as r:
        p = r.page
        new_account_with(r, f"feed{label[0]}", "feed")
        mark = len(r.console)
        p.goto(r.url("/feed"))            # a clean load of the Feed itself; everything from here counts
        p.wait_for_load_state("networkidle")
        if viewport[0] >= 900:
            rows = p.get_by_role("list", name="Artist queue").get_by_role("listitem")
            r.expect(rows.count() == 12, f"desktop queue lists the 12 seeded artists (got {rows.count()})")
            r.expect(p.get_by_role("region", name="Selected artist").get_by_role("heading", name="The Beatles").is_visible(),
                     "focus pane shows the first artist")
        else:
            r.expect(p.get_by_role("heading", name="The Beatles").is_visible(), "phone Snap feed shows the first artist's card")
            r.expect(p.get_by_role("article").count() == 12, f"one Snap card per seeded artist (got {p.get_by_role('article').count()})")
            r.expect(p.get_by_role("navigation", name="Main").get_by_role("link", name=re.compile("History")).is_visible(), "bottom tab bar is shown")
        p.wait_for_timeout(3000)          # let late chunks, images and the challenge strip settle
        broken = p.evaluate("[...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src)")
        r.expect(not broken, f"no broken images (CSP img-src allows the artwork host): {broken}")
        overflow = p.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        r.expect(overflow <= 0, f"no horizontal overflow at {viewport[0]}px (overflow {overflow}px)")
        r.shot(f"feed-{label}-{viewport[0]}x{viewport[1]}")
        feed_log = r.console[mark:]
        r.note("console during the Feed load (every line)", "\n".join(feed_log) or "(nothing logged)")
        bad = [l for l in r.problems() if l in feed_log]
        r.expect(not bad, f"no uncaught errors, console errors or CSP violations on the Feed: {bad}")
        return r.passed()


def feed_render():
    """Feed with a seeded queue at 390px and 1440px: no console errors, no CSP violations (features/feed.md)."""
    a = _feed_render(PHONE, "phone")
    b = _feed_render(DESKTOP, "desktop")
    return a and b


def feed_triage():
    """Feed: preview play/pause state, More / Less / Skip with DB rows, then History labels (features/feed.md)."""
    with Run(f"feed-triage-{STAMP}") as r:
        p = r.page
        _, u = new_account_with(r, "tri", "feed")
        pane = p.get_by_role("region", name="Selected artist")
        queue = p.get_by_role("list", name="Artist queue")

        pane.get_by_role("button", name="Play Hey Jude").click()
        pause = pane.get_by_role("button", name="Pause Hey Jude")
        try:
            pause.wait_for(timeout=10000)
            playing = True
        except Exception:
            playing = False
        r.expect(playing, "preview: the track button turns into Pause Hey Jude")
        p.wait_for_timeout(3000)
        progress = p.evaluate("(() => { const b = document.querySelector('.ev-track-bar > span'); return b ? b.style.transform : null })()")
        r.note("progress bar transform 3s after play", str(progress))
        r.expect(bool(progress) and progress != "scaleX(0)", f"preview: audio is really advancing (progress bar {progress})")
        r.expect(queue.get_by_role("button", name="Pause The Beatles").count() == 1, "preview: the queue row's art button reads Pause The Beatles")
        r.expect(p.get_by_text("Couldn't play this preview").count() == 0, "preview: no playback error toast")
        r.shot("playing")
        if playing:
            pause.click()
            r.expect(pane.get_by_role("button", name="Play Hey Jude").count() == 1, "preview: Pause puts the button back to Play Hey Jude")

        for artist, button, nxt in [("The Beatles", "More like this", "The Cure"), ("The Cure", "Less like this", "The Smiths"),
                                    ("The Smiths", "Skip this artist", "The Clash")]:
            pane.get_by_role("heading", name=artist).wait_for()
            p.wait_for_timeout(400)       # the feed ignores a second advancing decision within 350ms
            with p.expect_response(lambda s: "/api/feedback" in s.url and s.request.method == "POST") as resp:
                pane.get_by_role("button", name=button).click()
            r.expect(resp.value.ok, f"{artist}: POST /api/feedback answered {resp.value.status}")
            pane.get_by_role("heading", name=nxt).wait_for()
            r.expect(True, f"{artist}: after '{button}' the selection advances to {nxt}")
            r.note(f"{artist} after {button}", db_state(r, u, artist))
        state = lambda a: db_state(r, u, a)
        r.expect('"feedback_signal":"thumbs_up"' in state("The Beatles") and '"seen_at":"' in state("The Beatles"), "DB: The Beatles has a thumbs_up feedback row and seen_at")
        r.expect('"feedback_signal":"thumbs_down"' in state("The Cure"), "DB: The Cure has a thumbs_down feedback row")
        r.expect('"skip_at":"' in state("The Smiths") and '"feedback_signal":null' in state("The Smiths"), "DB: The Smiths has skip_at set and no feedback row")
        liked_row = queue.get_by_role("listitem").filter(has=p.get_by_role("button", name="Select The Beatles"))
        r.expect("Liked" in liked_row.inner_text(), "the liked artist stays in the queue with a Liked tag")
        p.wait_for_timeout(600)           # passed / dismissed rows animate out
        r.expect(queue.get_by_role("button", name="Select The Cure").count() == 0 and queue.get_by_role("button", name="Select The Smiths").count() == 0,
                 "the passed and skipped artists leave the queue")
        r.shot("after-three-decisions")

        p.reload()
        p.wait_for_load_state("networkidle")
        n = queue.get_by_role("listitem").count()
        r.expect(n == 9, f"after reload the queue holds the 9 undecided artists (got {n})")
        p.goto(r.url("/history"))
        p.get_by_role("heading", name="History").wait_for()
        row_of = lambda a: p.locator("div").filter(has=p.get_by_text(a, exact=True)).filter(has=p.get_by_role("button")).last
        for artist, label in [("The Beatles", "Liked"), ("The Cure", "Passed"), ("The Smiths", "Dismissed")]:
            r.expect(label in row_of(artist).inner_text(), f"History lists {artist} as {label}")
        r.shot("history")
        return r.passed()


def feed_save():
    """Save an unrated artist, reload, see Saved, one tap unsaves (features/feed.md)."""
    with Run(f"feed-save-{STAMP}") as r:
        p = r.page
        _, u = new_account_with(r, "save", "feed")
        pane = p.get_by_role("region", name="Selected artist")
        queue = p.get_by_role("list", name="Artist queue")
        row = queue.get_by_role("listitem").filter(has=p.get_by_role("button", name="Select The Cure"))

        p.get_by_role("button", name="Select The Cure").click()
        pane.get_by_role("heading", name="The Cure").wait_for()
        r.note("before save", db_state(r, u, "The Cure"))
        with p.expect_response(lambda s: "/api/saves" in s.url and s.request.method == "POST") as resp:
            pane.get_by_role("button", name="Save for later").click()
        r.expect(resp.value.ok, f"POST /api/saves answered {resp.value.status}")
        r.expect(pane.get_by_role("button", name="Saved").get_attribute("aria-pressed") == "true", "button reads Saved (pressed) after the tap")
        state = db_state(r, u, "The Cure")
        r.note("after save", state)
        r.expect('"saves":1' in state and '"feedback_signal":null' in state, "DB: a saves row exists and there is no feedback row (unrated)")
        r.note("seen_at after save", "POST /api/saves stamps recommendation_cache.seen_at (app/api/saves/route.ts): " + state)
        r.shot("saved")

        p.reload()
        p.wait_for_load_state("networkidle")
        in_queue = queue.get_by_role("button", name="Select The Cure").count() == 1
        # By design: saving stamps seen_at, so the card leaves the Feed and shows in History as Saved.
        r.expect(not in_queue, "after reload the saved card has left the Feed (saving marks it seen)")
        if in_queue:
            r.expect("Saved" in row.inner_text(), "after reload the queue row carries the Saved tag")
        else:
            p.goto(r.url("/history"))
            p.get_by_role("heading", name="History").wait_for()
            where = p.locator("div").filter(has=p.get_by_text("The Cure", exact=True)).filter(has=p.get_by_role("button")).last
            r.note("where the saved artist went", f"History row text: {where.inner_text()!r}")
            r.shot("reload-card-gone-now-in-history")
            # The only UI route back to "saved and unrated in the Feed": History's Return to feed.
            where.get_by_role("button", name="Return to feed").click()
            p.get_by_text("The Cure", exact=True).wait_for(state="detached", timeout=10000)
            state = db_state(r, u, "The Cure")
            r.note("after History > Return to feed", state)
            r.expect('"saves":1' in state and '"seen_at":null' in state, "after History > Return to feed: DB has the save and seen_at null")
            p.goto(r.url("/feed"))
            p.wait_for_load_state("networkidle")
            r.expect("Saved" in row.inner_text(), "returned to the Feed: the queue row carries the Saved tag on a fresh load")
        p.get_by_role("button", name="Select The Cure").click()
        pane.get_by_role("heading", name="The Cure").wait_for()
        saved_btn = pane.get_by_role("button", name="Saved")
        r.expect(saved_btn.count() == 1 and saved_btn.get_attribute("aria-pressed") == "true",
                 "on a fresh load the card's button reads Saved (pressed), not Save for later")
        r.shot("saved-on-fresh-load")

        with p.expect_response(lambda s: "/api/saves" in s.url) as resp:
            saved_btn.click()                         # exactly one tap
        r.note("unsave request", f"{resp.value.request.method} {resp.value.url} -> {resp.value.status}")
        r.expect(resp.value.request.method == "DELETE" and resp.value.ok, "one tap sent DELETE /api/saves and it succeeded")
        r.expect(pane.get_by_role("button", name="Save for later").get_attribute("aria-pressed") == "false", "button is back to Save for later")
        state = db_state(r, u, "The Cure")
        r.note("after unsave", state)
        r.expect('"saves":0' in state, "DB: the saves row is gone")
        r.shot("unsaved")
        return r.passed()


def history_return():
    """History 'Return to feed' on liked, skipped and dismissed rows (features/history.md)."""
    with Run(f"history-return-{STAMP}") as r:
        p = r.page
        name, u = new_account_with(r, "hist", "feed")
        r.seed(name, "history")
        p.get_by_role("navigation", name="Main").get_by_role("link", name=re.compile("^History")).first.click()
        p.wait_for_url(at("/history"))
        p.get_by_role("heading", name="History").wait_for()
        r.shot("history-before")

        def row_of(artist):
            return p.locator("div").filter(has=p.get_by_text(artist, exact=True)).filter(has=p.get_by_role("button")).last

        for artist, label, title in [("Joy Division", "Liked", "Return to feed"),
                                     ("Stereolab", "Skipped", "Return to feed"),
                                     ("Mogwai", "Dismissed", "Allow in feed again")]:
            row = row_of(artist)
            r.expect(label in row.inner_text(), f"{artist}: History row is labelled {label}")
            r.note(f"{artist} before", db_state(r, u, artist))
            row.get_by_role("button", name=title).click()
            try:
                p.get_by_text(artist, exact=True).wait_for(state="detached", timeout=10000)
                gone = True
            except Exception:
                gone = False
            r.expect(gone, f"{artist} ({label}): the row leaves History after '{title}'")
            state = db_state(r, u, artist)
            r.note(f"{artist} after", state)
            r.expect('"seen_at":null' in state and '"skip_at":null' in state, f"{artist}: DB seen_at and skip_at are both null")
            if label == "Liked":
                r.expect('"feedback_signal":"thumbs_up"' in state and '"feedback_deleted_at":"' in state,
                         f"{artist}: DB feedback row is soft-deleted (deleted_at set)")
            else:
                r.expect('"feedback_signal":null' in state, f"{artist}: DB has no feedback row (none before, none after)")
        r.shot("history-after-returns")

        p.reload()
        p.get_by_role("heading", name="History").wait_for()
        p.wait_for_load_state("networkidle")
        for artist in ("Joy Division", "Stereolab", "Mogwai"):
            r.expect(p.get_by_text(artist, exact=True).count() == 0, f"{artist}: not in History after a reload")
        r.expect(p.get_by_text("New Order", exact=True).count() == 1, "control: an untouched liked row (New Order) is still in History")
        r.shot("history-after-reload")

        p.get_by_role("navigation", name="Main").get_by_role("link", name=re.compile("^Feed")).first.click()
        p.wait_for_url(at("/feed"))
        queue = p.get_by_role("list", name="Artist queue")
        queue.wait_for()
        for artist in ("Joy Division", "Stereolab", "Mogwai"):
            r.expect(queue.get_by_role("button", name=f"Select {artist}").count() == 1, f"{artist}: back in the Feed queue (UI)")
        p.get_by_role("button", name="Select Joy Division").click()
        pane = p.get_by_role("region", name="Selected artist")
        pane.get_by_role("heading", name="Joy Division").wait_for()
        r.expect(pane.get_by_role("button", name="More like this").get_attribute("aria-pressed") == "false",
                 "Joy Division: shows as unrated in the Feed (More like this, not Liked)")
        p.get_by_role("button", name="Select Joy Division").scroll_into_view_if_needed()
        r.shot("feed-with-returned-artists")
        return r.passed()


def history_filters():
    """History filter chips and Load more (features/history.md)."""
    with Run(f"history-filters-{STAMP}") as r:
        p = r.page
        name, _ = new_account_with(r, "hfil", "feed")
        r.seed(name, "history")
        r.seed(name, "saved")
        p.goto(r.url("/history"))
        p.get_by_role("heading", name="History").wait_for()
        r.expect(p.get_by_role("button", name=re.compile(r"^All\s*50\+")).count() == 1, "All chip reads 50+ (first page of 63, more remain)")
        for label, present, absent in [("Liked", "Joy Division", "Pixies"), ("Passed", "Pixies", "Joy Division"),
                                       ("Dismissed", "Mogwai", "Stereolab"), ("Saved", "Low", "Mogwai"), ("Skipped", "Stereolab", "Low")]:
            p.get_by_role("button", name=re.compile(f"^{label}")).first.click()
            r.expect(p.get_by_text(present, exact=True).count() == 1 and p.get_by_text(absent, exact=True).count() == 0,
                     f"{label} chip shows {present} and hides {absent}")
        r.shot("filter-skipped")
        p.get_by_role("button", name=re.compile("^All")).first.click()
        before = p.get_by_role("button", name="Return to feed").count() + p.get_by_role("button", name="Allow in feed again").count()
        p.get_by_role("button", name="Load more").click()
        p.get_by_text("Verify Filler 55", exact=True).wait_for(timeout=10000)
        after = p.get_by_role("button", name="Return to feed").count() + p.get_by_role("button", name="Allow in feed again").count()
        r.expect(before == 50 and after == 63, f"Load more: 50 rows, then all 63 (got {before} -> {after})")
        r.expect(p.get_by_role("button", name="Load more").count() == 0, "Load more disappears when no pages remain")
        r.shot("after-load-more", full_page=True)
        return r.passed()


def saved():
    """Saved page: seeded saves listed, Remove unsaves and it sticks (features/saved.md)."""
    with Run(f"saved-{STAMP}") as r:
        p = r.page
        name, u = new_account_with(r, "saved", "feed")
        r.seed(name, "history")
        r.seed(name, "saved")
        p.get_by_role("navigation", name="Main").get_by_role("link", name=re.compile("^Saved")).first.click()
        p.wait_for_url(at("/saved"))
        def settled(text):               # the route's loading skeleton has the heading too: wait for the count
            try:
                p.get_by_text(text, exact=True).wait_for(timeout=10000)
                return True
            except Exception:
                return False
        r.expect(settled("3 artists"), "header counts the 3 seeded saves")
        for a in ("Low", "Radiohead", "Slowdive"):
            r.expect(p.get_by_role("button", name=f"Remove {a}").count() == 1, f"{a} has a card with a Remove button")
        r.shot("saved")
        with p.expect_response(lambda s: "/api/saves" in s.url and s.request.method == "DELETE") as resp:
            p.get_by_role("button", name="Remove Low").click()
        r.expect(resp.value.ok, f"Remove Low sent DELETE /api/saves ({resp.value.status})")
        r.expect(p.get_by_text("2 artists").count() == 1 and p.get_by_role("button", name="Remove Low").count() == 0, "the card leaves and the header reads 2 artists")
        left = r.sql(f"select count(*)::int as n from saves where user_id = '{u}'")
        r.expect('"n":2' in left, f"DB: two saves rows remain ({left})")
        p.reload()
        r.expect(settled("2 artists") and p.get_by_role("button", name="Remove Low").count() == 0, "still gone after a reload")
        r.shot("after-remove-and-reload")
        return r.passed()


def settings_delete():
    """Account deletion asks through window.confirm; dismiss keeps, accept deletes and signs out (features/settings.md)."""
    with Run(f"settings-delete-{STAMP}") as r:
        p = r.page
        _, u = new_account_with(r, "del", "feed")
        p.goto(r.url("/settings"))
        delete = p.get_by_role("button", name="Forget my account permanently")
        delete.wait_for()
        r.shot("settings")
        count = lambda: r.sql(f"select count(*)::int as n from users where id = '{u}'")

        r.dialog_action = "dismiss"
        delete.click()
        p.wait_for_timeout(1500)
        r.expect(len(r.dialogs) == 1 and r.dialogs[0] == "confirm: Permanently delete your account? This cannot be undone.",
                 f"one click opens the browser confirm dialog (saw {r.dialogs})")
        deletes = [q for q in r.requests if q.startswith("DELETE") and "/api/account" in q]
        r.expect('"n":1' in count(), "dismissing the dialog keeps the account (DB users row still there)")
        r.expect(p.url.endswith("/settings") and delete.is_enabled() and not deletes, "still on /settings, button usable, no DELETE /api/account was sent")
        r.shot("after-dismiss")

        r.dialog_action = "accept"
        with p.expect_response(lambda s: "/api/account" in s.url and s.request.method == "DELETE") as resp:
            delete.click()
        r.note("delete request", f"DELETE /api/account -> {resp.value.status}")
        r.expect(resp.value.status == 200, f"DELETE /api/account answers 200, not a redirect ({resp.value.status})")
        p.wait_for_url(r.url("/"), timeout=20000)
        r.expect(len(r.dialogs) == 2, "second click asks again")
        r.expect('"n":0' in count(), "accepting deletes the account (DB users row gone)")
        left = r.sql(f"select (select count(*) from recommendation_cache where user_id = '{u}')::int as recs")
        r.expect('"recs":0' in left, "DB: the user's recommendation_cache rows went with it (cascade)")
        r.expect(not any(c["name"].endswith("authjs.session-token") for c in r.ctx.cookies()), "signed out: no session cookie")
        r.expect("DELETE " + r.url("/") not in r.requests, "the page's fetch did not replay the DELETE against /")
        r.shot("landing-after-delete")
        p.goto(r.url("/settings"))
        r.expect("/sign-in" in p.url, f"signed out: /settings now redirects to sign-in ({p.url})")
        return r.passed()


def onboarding_seeds_fail():
    """Onboarding with POST /api/onboarding/seeds failing: stays put, error toast, button usable (features/onboarding.md)."""
    with Run(f"onboarding-seeds-fail-{STAMP}") as r:
        p, name = r.page, user("onb")
        r.sign_up(name)
        u = uid(r)
        r.note("account", f"username={name} id={u}")
        r.seed(name, "feed")              # only for the artists rows the search reads; see features/onboarding.md
        p.reload()
        p.get_by_role("button", name=re.compile("^Artists I like")).click()
        p.get_by_placeholder("Search artists…").fill("the ")
        for artist in ("The Beatles", "The Cure", "The Smiths"):
            p.get_by_role("button", name=re.compile(f"^{artist}")).click()
        go = p.get_by_role("button", name="Get started")
        r.expect(go.is_enabled(), "three artists picked: Get started is enabled")
        r.shot("three-artists-picked")

        # Browser-boundary fault injection: the fix under test is the client's reaction to a failed save.
        hits = []
        def fail(route):
            hits.append(route.request.method)
            route.fulfill(status=500, content_type="application/json", body='{"error":"injected by verify-flipside"}')
        p.route("**/api/onboarding/seeds", fail)
        go.click()
        toast = p.get_by_text("Couldn't save your artists. Try again.")
        try:
            toast.wait_for(timeout=10000)
            shown = True
        except Exception:
            shown = False
        r.expect(hits == ["POST"], f"the seeds POST was sent once and answered 500 by the interception ({hits})")
        r.expect(shown, "error toast: Couldn't save your artists. Try again.")
        p.wait_for_timeout(700)           # the toast fades in; "visible" to Playwright is not yet visible to a person
        if shown:
            seen = toast.evaluate("""e => { const t = e.closest('[data-sonner-toast]') || e, b = t.getBoundingClientRect();
                return { opacity: getComputedStyle(t).opacity, inViewport: b.top >= 0 && b.bottom <= innerHeight && b.width > 0 } }""")
            r.expect(seen["opacity"] == "1" and seen["inViewport"], f"the toast is on screen and opaque ({seen})")
        r.shot("seeds-failed")
        p.wait_for_timeout(2000)          # a wrong navigation would have happened by now
        r.expect(p.url.endswith("/onboarding"), f"still on /onboarding ({p.url})")
        r.expect(go.is_enabled() and go.inner_text() == "Get started", "Get started is usable again (enabled, not stuck on Saving…)")
        state = r.sql(f"select onboarding_completed_at, (select count(*)::int from seed_artists where user_id = u.id) as seeds from users u where id = '{u}'")
        r.note("after failed save", state)
        r.expect('"onboarding_completed_at":null' in state and '"seeds":0' in state, "DB: onboarding not stamped, no seed_artists rows")

        p.unroute("**/api/onboarding/seeds")
        go.click()                        # the retry the toast asks for, against the real route
        p.wait_for_url(at("/feed"), timeout=20000)
        state = r.sql(f"select onboarding_completed_at is not null as stamped, (select count(*)::int from seed_artists where user_id = u.id) as seeds from users u where id = '{u}'")
        r.note("after retry", state)
        r.expect('"stamped":true' in state and '"seeds":3' in state, "retry without the fault: lands on /feed, 3 seed_artists rows, onboarding stamped")
        r.shot("feed-after-retry")
        # The one 500 this journey injects with page.route.
        return r.passed(allow=("500 (Internal Server Error)  (https://localhost:3947/api/onboarding/seeds)",))


JOURNEYS = {
    "signin": signin, "feed-render": feed_render, "feed-triage": feed_triage, "feed-save": feed_save, "history-return": history_return,
    "history-filters": history_filters, "saved": saved, "settings-delete": settings_delete, "onboarding-seeds-fail": onboarding_seeds_fail,
}

if __name__ == "__main__":
    names = sys.argv[1:]
    if not names or names == ["list"]:
        for k, f in JOURNEYS.items():
            print(f"{k:24} {f.__doc__}")
        sys.exit(0)
    if names == ["all"]:
        names = list(JOURNEYS)
    failed = []
    for n in names:
        print(f"=== {n}")
        # Scaffolding: /sign-in allows 10 attempts a minute per IP and every journey signs up from
        # the same one. No journey here tests the limiter, so its window is cleared between journeys.
        from fvdrive import sql
        sql("delete from login_attempts")
        try:
            if not JOURNEYS[n]():
                failed.append(n)
        except Exception as e:  # a journey that cannot finish is a failure, with the reason
            print(f"ERROR {n}: {type(e).__name__}: {str(e).splitlines()[0]}")
            failed.append(n)
    print("FAILED: " + ", ".join(failed) if failed else "ALL PASSED")
    sys.exit(1 if failed else 0)

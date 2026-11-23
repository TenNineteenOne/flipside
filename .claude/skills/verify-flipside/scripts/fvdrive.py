"""verify-flipside Playwright helpers. Import from a journey script:

    import sys; sys.dont_write_bytecode = True   # keep __pycache__ out of the repo
    sys.path.insert(0, "<repo>/.claude/skills/verify-flipside/scripts")
    from fvdrive import Run

    with Run("my-check", viewport=(1440, 900)) as r:      # evidence -> ~/.cache/flipside-verify/evidence/my-check/
        r.sign_up("check-user")                             # real /sign-in page, New account
        r.seed("check-user", "feed")                        # fv seed
        r.page.goto(r.url("/feed"))
        r.shot("feed")                                      # numbered screenshot
        r.note("db", r.sql("select count(*) from users"))   # appended to notes.txt
        r.expect(cond, "what was expected")                 # records PASS/FAIL, never raises

Every console message, page error, failed request and >=400 response is written to console.log in
the evidence folder; `r.problems()` returns the ones that count as failures (errors, CSP reports).
"""
import os
import re
import subprocess
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

SCRIPTS = Path(__file__).resolve().parent
FV = str(SCRIPTS / "fv")
HOME = Path(os.environ.get("FLIPSIDE_VERIFY_HOME", Path.home() / ".cache/flipside-verify"))
APP = "https://localhost:3947"  # must match NEXTAUTH_URL in fv (self-signed HTTPS; see the comments there)
PHONE = (390, 844)
DESKTOP = (1440, 900)


def sql(query: str) -> str:
    """Run one statement on the throwaway DB; returns JSON lines."""
    out = subprocess.run([FV, "sql", "-c", query], capture_output=True, text=True)
    return (out.stdout + out.stderr).strip()


class Run:
    def __init__(self, name: str, viewport=DESKTOP, mobile: bool | None = None):
        self.dir = HOME / "evidence" / name
        self.dir.mkdir(parents=True, exist_ok=True)
        self.viewport = viewport
        # Phone widths get a touch, mobile-UA context so the server's layout guess matches a real phone.
        self.mobile = viewport[0] < 640 if mobile is None else mobile
        self.results: list[tuple[bool, str]] = []
        self.console: list[str] = []
        self.requests: list[str] = []   # "METHOD url" for every request the page made
        self.dialogs: list[str] = []
        self.dialog_action = "dismiss"  # or "accept"; every dialog is recorded in self.dialogs
        self.n = 0

    def __enter__(self):
        self._pw = sync_playwright().start()
        self.browser = self._pw.chromium.launch(headless=True)
        kw = dict(viewport={"width": self.viewport[0], "height": self.viewport[1]}, ignore_https_errors=True)
        if self.mobile:
            kw.update(is_mobile=True, has_touch=True, device_scale_factor=3, user_agent=(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
                "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"))
        self.ctx = self.browser.new_context(**kw)
        self.page = self.ctx.new_page()
        self.watch(self.page)
        return self

    def __exit__(self, *exc):
        (self.dir / "console.log").write_text("\n".join(self.console) + "\n")
        lines = [f"{'PASS' if ok else 'FAIL'}  {what}" for ok, what in self.results]
        if exc[0]:
            lines.append(f"ERROR  journey aborted: {exc[0].__name__}: {exc[1]}")
            try:
                self.shot("aborted")
            except Exception:
                pass
        (self.dir / "result.txt").write_text("\n".join(lines) + "\n")
        print("\n".join(lines))
        print(f"evidence: {self.dir}")
        self.browser.close()
        self._pw.stop()
        return False

    # --- observation
    def watch(self, page):
        log = lambda kind, text: self.console.append(f"[{time.strftime('%H:%M:%S')}] {kind}: {text}")
        page.on("console", lambda m: log(f"console.{m.type}", f"{m.text}  ({m.location.get('url', '')})"))
        page.on("pageerror", lambda e: log("pageerror", str(e)))
        page.on("requestfailed", lambda q: log("requestfailed", f"{q.method} {q.url} {q.failure}"))
        page.on("response", lambda s: s.status >= 400 and log("http", f"{s.status} {s.request.method} {s.url}"))
        page.on("request", lambda q: self.requests.append(f"{q.method} {q.url}"))
        page.on("dialog", self._dialog)

    def _dialog(self, d):
        self.dialogs.append(f"{d.type}: {d.message}")
        self.console.append(f"[{time.strftime('%H:%M:%S')}] dialog.{d.type} ({self.dialog_action}): {d.message}")
        d.accept() if self.dialog_action == "accept" else d.dismiss()

    def problems(self, ignore: tuple[str, ...] = ()) -> list[str]:
        """Uncaught errors, console errors and CSP violations so far (CSP reports arrive as console errors)."""
        bad = re.compile(r"\] (pageerror|console\.error):|Content Security Policy|Content-Security-Policy", re.I)
        return [l for l in self.console if bad.search(l) and not any(i in l for i in ignore)]

    def shot(self, label: str, full_page: bool = False) -> Path:
        self.n += 1
        path = self.dir / f"{self.n:02d}-{label}.png"
        self.page.screenshot(path=str(path), full_page=full_page)
        return path

    def note(self, label: str, text: str):
        with open(self.dir / "notes.txt", "a") as f:
            f.write(f"## {label}\n{text}\n\n")

    def expect(self, ok, what: str) -> bool:
        self.results.append((bool(ok), what))
        return bool(ok)

    # --- app conveniences
    def url(self, path: str) -> str:
        return APP + path

    def sql(self, query: str) -> str:
        return sql(query)

    def seed(self, username: str, what: str = "all") -> str:
        out = subprocess.run([FV, "seed", username, what], capture_output=True, text=True)
        text = (out.stdout + out.stderr).strip()
        self.note(f"fv seed {username} {what}", text)
        if out.returncode not in (0, 3):  # 3 = seeded with warnings (see the note)
            raise RuntimeError(f"seed failed: {text}")
        return text

    def sign_up(self, username: str):
        """Create an account through the real sign-in page. Ends on /onboarding (new accounts have no seeds)."""
        p = self.page
        p.goto(self.url("/sign-in?mode=new"))
        p.get_by_role("textbox", name="Username").fill(username)
        p.get_by_role("checkbox", name="I understand my username cannot be recovered if I forget it.").check()
        p.get_by_role("button", name="Create account").click()
        p.wait_for_url("**/onboarding", timeout=20000)

    def sign_in(self, username: str, dest: str = "**/feed"):
        p = self.page
        p.goto(self.url("/sign-in"))
        p.get_by_role("textbox", name="Username").fill(username)
        p.get_by_role("button", name="Sign in", exact=True).click()
        p.wait_for_url(dest, timeout=20000)

    def skip_onboarding(self):
        """Onboarding's own 'Skip for now' path: stamps onboarding_completed_at and goes to /feed."""
        self.page.get_by_role("button", name="Skip", exact=True).click()
        self.page.wait_for_url("**/feed", timeout=20000)

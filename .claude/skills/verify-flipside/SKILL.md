---
name: verify-flipside
description: Launch flipside (the Next.js music-discovery web app) against a throwaway local backend and drive its web UI in headless Chromium to prove behaviour live - sign-in, Feed, History, Saved, Settings, onboarding. Use when a change to this repo has only been unit-tested and needs to be seen working in a real browser with real database rows, or when asked to "verify", "check live", "drive the app" or "screenshot" flipside.
---

# verify-flipside

Drives the real app the way a user does and captures proof. Read `features/README.md` and the
feature file for what you are checking before driving anything.

**Surface:** the web UI (primary). The JSON API under `/api/*` is only reached through the UI here.
**Never** point any of this at `flipside-t19.vercel.app` or a real Supabase project. Everything
below runs on loopback with secrets generated at launch and deleted at stop.

All commands are run from the repo root. `fv` is `.claude/skills/verify-flipside/scripts/fv`.

## What the stack is

This machine has no docker, supabase CLI, psql or sudo, so launch stands up a stand-in backend:

| Piece | What | Port |
|---|---|---|
| Postgres 18.7 | binaries from the `embedded-postgres` npm package (has `pg_trgm`, `uuid-ossp`); empty data dir each launch | 54329 |
| PostgREST 16.6 | official static binary; the REST layer supabase-js talks to | 54330 |
| `scripts/rest-proxy.mjs` | strips `/rest/v1` (supabase-js adds it, PostgREST serves at `/`); this is `NEXT_PUBLIC_SUPABASE_URL` | 54331 |
| the app | `next build` then `next start`, plain HTTP, loopback | 3946 |
| `scripts/tls-proxy.mjs` | self-signed HTTPS in front of the app. **Drive this one:** `https://localhost:3947` | 3947 |

Binaries live in `~/.cache/flipside-verify/` (outside the repo; `fv install` fetches them, launch
calls it when missing). Nothing is added to the repo's `package.json`.

Why a production build and not `next dev`: `next dev` serves a different CSP (`unsafe-eval`, `ws:`),
compiles on first hit (slow, flaky waits), rewrites `AGENTS.md`, and takes the dev lock the owner's
own dev server on port 3000 needs. Why HTTPS: the production CSP carries
`upgrade-insecure-requests`; over plain HTTP Chromium upgrades redirected fetches to `https://` and
they fail (seen on `DELETE /api/account`). Over HTTPS the cookies are the production
`__Secure-authjs.session-token` kind and the CSRF check (`lib/csrf.ts`) sees an `https://` origin,
as on Vercel. Why `localhost` and not `127.0.0.1`: Next rewrites `127.0.0.1` to `localhost` in
request URLs, so next-auth redirects change origin and the session cookie is lost.

Cost: launch rebuilds `.next/` in the repo (git-ignored) with the stand-in's URL inlined. An owner
`next start` afterwards needs its own `next build`.

## Launch

```bash
.claude/skills/verify-flipside/scripts/fv launch
```

It refuses to start if any of its ports is taken or a previous run dir exists. In order: fresh
throwaway secrets into `~/.cache/flipside-verify/run/env` (AUTH_SECRET, USERNAME_HMAC_SECRET,
USERNAME_ENCRYPTION_KEY, CRON_SECRET, a JWT secret and a service-role JWT signed with it) ->
`initdb` + start Postgres -> `scripts/bootstrap.sql` (Supabase stand-ins) -> every file in
`supabase/migrations/` in order, unmodified, one transaction each -> PostgREST -> proxy ->
`next build` -> `next start` -> HTTPS proxy -> doctor. About 15 seconds with a warm build cache.

**Ready** is the last line: `READY  app=https://localhost:3947 ...`, printed only after doctor
passed (so the schema is in, the service-role JWT is accepted through the proxy, and a page
renders). If a migration fails, launch stops, names the file, copies the logs to
`~/.cache/flipside-verify/evidence/last-failed-launch/` and tears everything down. A migration
failure is a finding to report; do not edit the migration.

**Last.fm.** There is no `LASTFM_API_KEY` on this machine, so the engine cannot generate a feed,
Last.fm sync cannot run, and onboarding search only finds artists already in the `artists` table.
`fv launch` passes `LASTFM_API_KEY` (also `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`) through
if they are exported in the shell that runs it. Never fake Last.fm inside the app. Journeys that
only need existing rows use `fv seed` (below). iTunes is keyless and is called for real.

## Doctor

```bash
.claude/skills/verify-flipside/scripts/fv doctor
```

Read-only. Run it first whenever something looks off. Checks: each recorded pid is alive and owns
its port; the schema exists; the service-role JWT works through `/rest/v1`; `/sign-in` answers
200; the app process's environment points at the local proxy (not a real Supabase project); the
build was made from the current `HEAD`. It notes changed product files and whether
`LASTFM_API_KEY` is set. Exit code 0 means worth driving.

The build check fails as soon as someone commits mid-session ("built from 89540a9, HEAD is now
915be70"). The running build is still a valid build of the commit it names: results from it
describe that commit, not `HEAD`. To test the new `HEAD`, relaunch: `fv stop && fv launch`.

## Drive

Harness: Python Playwright with headless Chromium (already installed), through two helpers.

```bash
S=.claude/skills/verify-flipside/scripts
python3 $S/journeys.py list                 # the scripted journeys, one line each
python3 $S/journeys.py feed-triage          # run one (exit code 1 if any expectation failed)
python3 $S/journeys.py all
$S/fv seed <username> [feed|history|saved|all]   # rows for an account that already exists
$S/fv sql -c "select id, onboarding_completed_at from users"   # read (or set up) the throwaway DB
```

For anything not scripted yet, write a short script on `scripts/fvdrive.py` (its docstring is the
API): `Run(name, viewport)` gives a page that records the console, page errors, failed requests,
every request and every dialog, plus `sign_up`, `sign_in`, `skip_onboarding`, `seed`, `sql`,
`shot`, `note`, `expect`, `problems`, `passed`. Put the script in your scratch directory, not in the repo, unless it is
a journey worth keeping (then add it to `journeys.py` and to the feature file).

Rules that hold for every journey:

- **Accounts are made through the real `/sign-in` page** (`Run.sign_up`): New account, username,
  the no-recovery checkbox, Create account. Never forge a session cookie.
- A new account lands on `/onboarding`. Leave it the way a user would: `Skip` (stamps
  `onboarding_completed_at`) or pick artists and `Get started`.
- Seed **after** sign-up and **before** opening `/feed`: an empty queue shows the "Building your
  feed" loader, which needs Last.fm. Keep at least 8 unseen rows or the Feed tries a background
  top-up (harmless without a key, but it is not what you are testing).
- Viewports: desktop layout needs >= 900px wide and >= 540px tall; phone (Snap) below 640px.
  `Run` gives widths under 640 a touch context with a mobile user agent, so the server's layout
  guess matches. Use `PHONE` (390x844) and `DESKTOP` (1440x900) from `fvdrive`.
- Selectors: roles and accessible names, read from the components. Each feature file lists them.
- `window.confirm` dialogs: set `r.dialog_action = "accept"` or `"dismiss"` before the click;
  every dialog is recorded in `r.dialogs`.
- Await a destination by its path: `p.wait_for_url(at("/settings"))` (`from fvdrive import at`),
  or the exact URL (`r.url("/")`). Never a `"**/settings"` glob: it also matches
  `/sign-in?from=/settings`, so the wait passes when sign-in never navigated.
- `page.wait_for_function("<string>")` fails here: the production CSP has no `unsafe-eval`, and a
  string predicate is evaluated in the page. Use `wait_for_url(lambda url: ...)`, locator waits
  (`locator.wait_for()`, `expect(locator)`), or poll from Python with `p.evaluate(...)`, which is
  not subject to the page's CSP.
- End every journey with `return r.passed(allow=(...))`. It fails the journey on any console
  error, page error, CSP report or failed request the run collected (`r.problems()`), except
  lines containing a substring on that journey's `allow` tuple. List only what the journey causes
  on purpose, with the reason in a comment. `net::ERR_ABORTED` request failures are never counted:
  that is the page cancelling its own request (a navigation dropping a prefetch).

## Evidence

Everything goes to `~/.cache/flipside-verify/evidence/<journey>-<HHMMSS>/` (outside the repo).
To write somewhere else (a scratch folder for a one-off sweep), set `FLIPSIDE_VERIFY_EVIDENCE` to
the root folder before running `journeys.py` or importing `fvdrive`; each `Run(name)` then writes
to `$FLIPSIDE_VERIFY_EVIDENCE/<name>/`. `fv` itself (failed-launch logs) keeps the default.

- `result.txt` one PASS / FAIL line per expectation (and `ERROR` if the journey could not finish)
- `NN-<label>.png` screenshots, numbered in the order taken
- `notes.txt` database rows before and after each action, request statuses, seed output
- `console.log` every console message, page error, failed request, >= 400 response and dialog

Proof standards:

- Exercise the real user path: clicks on the real page. Not API calls, not internal setters.
- Capture the action and the resulting state: screenshot or note before and after, not only the end.
- Check the side effect in the database next to what the screen shows (`r.sql`), and re-check
  after a reload: an optimistic UI can show a state the server never stored.
- No mocks inside the app. The one accepted fault injection is Playwright `page.route` at the
  browser boundary when the thing under test is the client's reaction to a failing request
  (`onboarding-seeds-fail`); say so in the report whenever it is used.
- A journey that cannot run is reported as could-not-run with the reason, never quietly swapped
  for an easier one. The reason goes in that feature's Gotchas.
- A FAIL is a finding to report with exact steps. Do not fix product code from this skill.

## Cleanup

```bash
.claude/skills/verify-flipside/scripts/fv stop
```

Stops what launch started, by recorded pid (each service's process group; Postgres through
`pg_ctl` on its data dir), confirms the five ports are free, then deletes
`~/.cache/flipside-verify/run/` (database, logs, throwaway secrets, TLS key). It never kills by
name and never touches a process it did not start. **Evidence is kept:**
`~/.cache/flipside-verify/evidence/` is never deleted by any command here. Run `fv stop` after
every failed attempt too. `.next/` stays (see "Cost" above).

## Helpers

| File | Invocation | What |
|---|---|---|
| `scripts/fv` | `fv install \| launch \| doctor \| stop \| sql \| seed` | the launcher; ports and versions are at its top |
| `scripts/journeys.py` | `python3 journeys.py list \| <name>... \| all` | scripted journeys with DB checks |
| `scripts/fvdrive.py` | `from fvdrive import Run, PHONE, DESKTOP` | Playwright helper (see its docstring) |
| `scripts/seed.cjs` | via `fv seed <username> [feed\|history\|saved\|all]` | seeds a user's queue, history, saves; real iTunes previews, cached |
| `scripts/pg.cjs` | via `fv sql -c "..."` / `fv sql -f file.sql` | SQL client (there is no psql) |
| `scripts/bootstrap.sql` | applied by launch | Supabase stand-ins: roles, `auth.uid()`, default grants |
| `scripts/rest-proxy.mjs`, `scripts/tls-proxy.mjs` | started by launch | the `/rest/v1` and HTTPS proxies |

## What the stand-in does that a real Supabase project does not need

Proved here against the local stack only. These steps are stand-in setup; behaviour that depends
on them is unverified on a real project until a run there covers it:

1. `bootstrap.sql`: creates roles `anon`, `authenticated`, `service_role` (bypassrls),
   `authenticator`; schema `auth` with `auth.uid()`; an empty `extensions` schema; and Supabase's
   default privileges (grant all on new public tables / sequences / functions to the three roles).
2. Extensions `uuid-ossp` and `pg_trgm` land in `public` (Supabase keeps them in `extensions`).
3. Postgres 18.7 with trust auth on loopback; Supabase runs its own Postgres version and pooler.
4. PostgREST 16.6 configured by hand (`public` schema, `anon` role, 1000-row cap) and a path
   proxy in place of Supabase's API gateway. The gateway's `apikey` header check does not exist here.
5. A service-role JWT minted locally with a made-up secret.
6. The app runs under `next start` behind a self-signed HTTPS proxy on `localhost`, with
   `AUTH_URL`, `NEXTAUTH_URL` and `AUTH_TRUST_HOST=true` set. Vercel's own headers (`x-real-ip`,
   `VERCEL_URL`), serverless lifetimes and the cron are absent. Every sign-in comes from one IP,
   so `journeys.py` clears `login_attempts` between journeys.
7. Seeded rows stand in for what the engine writes. They follow the shapes the pages read, but
   the engine itself (Last.fm walk, scoring, preview confirmation) never ran here.

## Keeping the map honest

When a screen, label or route changes, update the matching file in `features/` and its journey.
`/maintain-verification-skill` runs that loop.

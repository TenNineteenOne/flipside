# Flipside — Security Review Findings

**Date:** 2026-06-05 · **Branch:** Nick · **Method:** 15-shard parallel static audit (66 agents, ~1.8M tokens, 1,432 tool calls) → adversarial per-finding verification → human synthesis & re-grading.
**Config confirmed by owner:** repo public (no secrets committed — verified); RLS enabled & migrations applied; `AUTH_SECRET` / HMAC / encryption keys set.

---

## Bottom line

**Flipside is safe to share with coworkers from a security standpoint.** The audit found **no IDOR, no injection, no authentication bypass, no secret exposure, and no broken cryptography.** The threat that matters most for an internal share — an *authenticated coworker trying to read or mutate another coworker's data* — is well-defended: every API route and every Server Component page independently authenticates and scopes every query to the session's `userId`. The Supabase service-role client (which bypasses RLS) is used throughout, but the application-layer scoping that backs it is **complete** across all 24 routes, all page loaders, and the lib data-access helpers they call.

What remains is **dependency hygiene, one real cost/DoS issue, several defense-in-depth hardening gaps, and a privacy-transparency note.** None is individually catastrophic; fixing them makes a already-solid app tight.

### What was checked and found clean (high confidence)
- **Authorization / IDOR** (shards A1–A5): every user-scoped query constrained to the authenticated `userId`; path/query/body params cannot substitute another user's id; RPCs (`rpc_record_feedback`, `rpc_delete_feedback`, `rpc_clear_dismiss`, challenge increment) enforce `WHERE user_id = p_user_id` and have EXECUTE revoked from anon/authenticated. **0 findings.**
- **DB / RPC / query-builder injection & mass-assignment** (E): `PATCH /settings` uses an explicit column allowlist (no over-posting); no unsafe `.or()/.filter()` string concatenation; SECURITY DEFINER RPCs are parameterized. **0 findings.**
- **Crypto / data-at-rest** (J): AES-256-GCM envelope encryption is correct (unique IV, auth tag, key-length check); HMAC username hashing is cryptographically sound; `DELETE /api/account` cascades all user-scoped tables. **Implementation verified correct.**
- **Secret exposure**: no secret-shaped literals anywhere in the tracked tree or git history (only `.env.example` placeholders ever committed); no secret-bearing `NEXT_PUBLIC_*`; service-role key never reaches the client bundle; source maps disabled.
- **XSS**: both `dangerouslySetInnerHTML` sites are safe — `layout.tsx` injects a static CSS string (no user data); `identicon-avatar.tsx` renders `@dicebear`-generated SVG from a user-id seed (library-sanitized).
- **CSRF**: every genuine mutating route enforces same-origin (directly or via `withAuthedCsrf*/withAuthedJson*` wrappers). The same-origin logic itself has no forgeable-header bypass.

---

## Findings (surviving adversarial verification)

Severity reflects the verifier's corrected grade, leading with **reachability**. 7 candidate findings were **refuted** and dropped (listed at end).

### Tier 1 — Recommended, **no functionality cost**

| # | Sev | Finding | Location | Fix |
|---|-----|---------|----------|-----|
| 1 | **High** | `next@16.2.4` carries multiple advisories incl. a **Server-Components DoS (GHSA-8h8q-6873-q5fj, reachable by authenticated users)** and middleware-bypass CVEs. *(The middleware-bypass path is **not** reachable here — auth doesn't depend on proxy; pages self-check — but the DoS is.)* | `package.json` (next) | `npm audit fix` → 16.2.7 (semver-patch, no breaking change). Re-run build + tests. |
| 2 | **High→Med** | `npm audit`: 14 advisories total. Most are transitive/unreachable (`ws`, `qs`, `hono`, `fast-uri`, `brace-expansion`, `express-rate-limit`, `postcss`) but all fixed by a safe bump. | `package.json` | `npm audit fix` (NOT `--force` — force would semver-major-downgrade `node-vibrant`). |
| 3 | Low | `resolve-track`: `spotifyArtistId` not run through `isValidSpotifyId` before URL/DB use. Currently **unreachable** (DB guard blocks it), but the other routes validate — close the inconsistency. | `app/api/spotify/resolve-track/route.ts:52` | Add `if (spotifyArtistId && !isValidSpotifyId(spotifyArtistId)) return apiError("Invalid artist ID",400)`. |
| 4 | Low | `artist_tracks_cache` shared-cache UX poisoning: `GET /artists/[id]/tracks?name=` stores `name`'s tracks under a mismatched artist id, served to all users 24h. No PII/escalation — wrong-tracks only. | `app/api/artists/[id]/tracks/route.ts:22,47` | Cross-check `?name=` against `artist_search_cache` for that id before writing (additive). |
| 5 | Low | **Logout-CSRF**: `POST /api/auth/signout` has no same-origin check (NextAuth `signOut` uses `skipCSRFCheck`) and is excluded from proxy. Route is **orphaned** (client uses `next-auth/react`), impact = forced logout only. | `app/api/auth/signout/route.ts` | Add `enforceSameOrigin` (preferred — keeps the route), or remove the unused route. |
| 6 | Low | `colour-extraction`: no response-body size cap before `arrayBuffer()` → `node-vibrant` parse; and the `file-type` transitive dep (via node-vibrant) has an infinite-loop DoS on malformed input. Reachable only via CDN/supply-chain compromise (host allowlist blocks user input). | `lib/colour-extraction.ts:134,140` | Add a `Content-Length` cap (e.g. 5 MB) before `arrayBuffer()`; wrap `getPalette()` in a timeout. (Avoids the node-vibrant downgrade.) |
| 7 | Low | **Rate-limiter TOCTOU**: read-then-upsert isn't atomic; concurrent requests can exceed the cap by a factor of concurrency. Low impact (login is username-only, no password to brute-force). | `lib/rate-limiter.ts:48-68` | Replace with an atomic Postgres `INSERT … ON CONFLICT … DO UPDATE SET attempt_count = attempt_count+1 RETURNING` (RPC). |
| 8 | Info | `test-colour.js` stray dev script committed at repo root. | `test-colour.js` | Delete. |

### Tier 2 — Recommended, **small functionality consideration → DECISION REQUIRED**

| # | Sev | Finding | Location | Decision |
|---|-----|---------|----------|----------|
| 9 | **Med** | **`explore/generate?force=true` has no per-user cooldown** — fully bypasses the 24h cache, fans out 4 rails × many Last.fm/Spotify calls per request. An authenticated user in a loop can burn operator API quota & compute. (The feed has a 30s cooldown; Explore deliberately has none.) | `app/api/explore/generate/route.ts:33`, `explore-engine.ts:888` | Adding a cooldown **throttles rapid Explore re-rolls** — a UX change. See decision below. |
| 10 | **Med** | **Content-Security-Policy header absent.** No standalone exploit (this is second-line defense behind the already-clean XSS surface), but a strict CSP is the single biggest hardening win. The `layout.tsx` inline `<style>` forces either `style-src 'unsafe-inline'` or a small refactor. | `next.config.ts:7-16` | Strict vs. `unsafe-inline` vs. report-only-first. See decision below. |

### Tier 3 — Config / your action (not code)

- **Confirm proxy compiles on a fresh `next build`** — current `.next/server/middleware-manifest.json` is empty, but `.next` is likely stale and auth does not depend on proxy (Next docs say not to use proxy for authz; the app correctly self-checks per route). Low priority.
- **`AUTH_SECRET` length** — if 64 *hex chars* (256-bit), perfect; if literally 64-bit (16 chars), regenerate with `openssl rand -hex 32`.
- **Privacy transparency** — stored per-user data is broader than "only a hashed username": also `spotify_id`, `flipside_playlist_id`, `selected_genres`, `market`, and full listen history (artists/feedback/saves) — all appropriately stored (encrypted where sensitive), but worth telling coworkers what's retained. `login_attempts` stores unsalted SHA-256 of IPs (reversible for IPv4 by brute force — low concern, short-lived rows).

---

## Refuted findings (verified false positives — no action)

1. **next middleware-bypass RSC exfiltration** — auth doesn't depend on proxy; every page self-checks & redirects before serializing data.
2. **resolve-track SSRF reachable** — DB guard blocks the traversal payload from ever reaching the fetch.
3. **artists/[id]/tracks `?name` length** — timeout-bounded, errors swallowed; nil impact (hygiene only).
4. **CSRF fail-open in test/CI** — dead branch; localhost origins are always added in non-prod, so `allowed.size` is never 0 there; prod fails closed.
5. **`error.tsx` leaks `error.message`** — no route outside `(app)/` throws dynamic messages; `(app)/error.tsx` renders a static string.
6. **Login limiter lacks per-username limiting** — username-only auth means no brute-force surface; per-username limiting would *add* a lockout-DoS.
7. **history/accumulate cooldown race** — self-only blast radius, double-guarded by resolution idempotency + cache.

---

## Update 2026-10-24 — login guessing hardening (#175 D3)

Sweep 1 found that every wrong-username sign-in silently created an account, so guessing friends' usernames was free and the only signal was a hit; and the 10/min limiter keyed on the full IP, so an IPv6 /64 or a proxy pool got a fresh bucket per address.

- **No more auto-create.** Sign-in now has explicit **Existing account** (default) and **New account** modes. Existing never creates; an unknown name gets the same generic error as an invalid one. New never signs into a taken name and says it's taken (an accepted enumeration signal, rate-limited like everything else). Logic: `lib/auth-sign-in.ts`.
- **Rate limits** (same atomic RPC, migration 0035, no new migration: the RPC takes any key string and per-call limits): per IP 10/min (unchanged), per IPv6 /64 20/min, global 300/min. Checked in order, stopping at the first full bucket, so one blocked address can't fill the global cap alone.
- **Still open:** all buckets fail open on DB error (baseline; a DB outage fails sign-in anyway at the `users` lookup). A distributed attacker can exhaust the global cap and block sign-in for everyone for about a minute after the flood. Session `maxAge` is still the NextAuth default (30 days); shortening it, or invite codes for New account, remain options.

## Update 2026-10-24 — sweep 2 server/security fixes (#175 Y1)

- **Explore cooldown bypass closed again (S1).** Sweep 1's D5 nulled `users.last_explore_generated_at` on every taste change, so a thumb followed by `POST /api/explore/generate?force=true` could start unlimited overlapping builds. Reverted; taste changes no longer touch `users`. Known race kept: a settings change during an in-flight Explore build can leave old-settings rails until TTL. The proper fix (a version stamp) is deferred with #168.
- **Image optimizer off (S5).** `images.unoptimized: true`. Anonymous `/_next/image` requests over many distinct allowed-CDN URLs could exhaust the Vercel Hobby transformation quota. Art now loads straight from the Spotify/Apple CDNs, which CSP `img-src` already allows.
- **Onboarding seed cap (S6).** `POST /api/onboarding/seeds` now enforces the 200 total-seed cap (existing + new), shared with `/api/settings/seed-artists` via `lib/api/seed-cap.ts`.
- **node-vibrant parser loop (S7).** Colour extraction only hands JPEG/PNG/WebP magic bytes to node-vibrant. This sidesteps the `file-type` ASF loop (GHSA-5v7r-6r5c-r473), which the 5s `setTimeout` race can't interrupt because it blocks the event loop. The dependency is still flagged by `npm audit`.
- **Type guards (S8).** Non-string `lastfmUsername`/`statsfmUsername` and JSON `null` bodies on the seed and resolve routes return the route's 400 instead of a 500.
- **`/open` negative cache (R5).** Only an answered iTunes no-match is cached as NULL. An iTunes failure, such as a 403 storm, no longer pins artists to the search URL for 30 days across all users.

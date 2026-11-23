# Flipside — Security Review Plan

**Goal:** Make Flipside safe to share with coworkers. Drive the residual security risk
of a self-hosted, single-tenant-per-user music-discovery app to as close to zero as is
practical, **without silently dropping functionality**. Any remediation that would cost a
feature is surfaced as an explicit decision with alternatives.

**Date:** 2026-06-05 · **Branch:** Nick · **Reviewer:** automated multi-agent sweep + human-in-loop synthesis

---

## 1. What the app actually is (threat model inputs)

- **Next.js 16** (App Router) + **NextAuth v5 beta** (JWT sessions, Credentials provider — username only) + **Supabase** (Postgres) + Spotify / Last.fm / stats.fm / iTunes integrations. Deployed on **Vercel**. Public GitHub repo (`TenNineteenOne/flipside`).
- **Identity:** username → HMAC-SHA256 (`USERNAME_HMAC_SECRET`) → `users.username_hash`. No password, no email. A daily cron prunes the recommendation cache.
- **Stored PII (claimed "only a hashed username"):** to be *verified*. Known: `username_hash` (HMAC), Last.fm / stats.fm usernames **envelope-encrypted at rest** (AES-256-GCM, `USERNAME_ENCRYPTION_KEY`), hashed login-attempt IPs, music-taste data (artists, feedback, saves, history).
- **Trust boundary that matters most:** **almost every API route and lib data path uses the Supabase _service-role_ client, which bypasses RLS entirely.** RLS policies exist but are explicitly defense-in-depth only (the migrations say so). Therefore **application-layer `userId` scoping is the sole real authorization enforcement.** A single missing `.eq("user_id", userId)` = cross-account data access.

### Adversary model
1. **Authenticated coworker** poking at another coworker's data (the primary realistic threat — IDOR / horizontal priv-esc).
2. **Unauthenticated internet** hitting the deployment (authz bypass, secret exposure, DoS/cost).
3. **Malicious external service / response** (compromised or attacker-influenced Spotify/Last.fm/iTunes responses → SSRF, injection, XSS via reflected data).
4. **Supply chain** (dependency vulns, build-time compromise).
5. **Curious user reading the public repo** (secret leakage in source/history/bundle).

### Explicitly out of scope (state assumptions, don't chase)
- Supabase/Vercel platform compromise; physical/email account takeover of the owner.
- DAST/live pen-testing against the running deployment (this is a static + architectural review). Note where a live check is the only way to confirm.

---

## 2. Surface decomposition (review shards)

Each shard is an independent agent with a tight, file-scoped brief and a structured findings schema. Findings flow into an **adversarial verification** pass before they reach the report.

| # | Shard | Core question | Key files |
|---|-------|---------------|-----------|
| **A1–A5** | **Object-level authorization / IDOR** (split across the 24 routes in ~5 buckets) | Is *every* service-role query that touches a user-scoped table constrained to the authenticated `userId`? Can a path/query param (`[artistId]`, `[id]`, `[platform]`, body `userId`) read or mutate another user's rows? | all `app/api/**/route.ts`, `lib/recommendation/*`, `lib/history/*`, `lib/settings/*` |
| **B** | **Auth & session integrity** | Credentials provider validation; JWT/session callbacks; the Spotify `accessToken`-in-JWT path (note: `auth.ts` declares only Credentials yet `get-access-token` reads `token.accessToken` — reconcile); `safeAuth` cookie-clear; `proxy.ts` matcher gaps; open-redirect via `?from=` and signin callback; signout. | `lib/auth.ts`, `lib/get-access-token.ts`, `proxy.ts`, `app/api/auth/**` |
| **C** | **CSRF completeness** | Every mutating method wrapped in `enforceSameOrigin`/`withAuthedCsrf*`? Audit `csrf.ts` for bypass (null-Origin accept, `Sec-Fetch-Site` fallback, Referer trust). **Known candidate: `auth/signout` POST has no same-origin check.** | `lib/csrf.ts`, `lib/api/with-authed-route.ts`, all mutating routes |
| **D** | **SSRF & outbound-request injection** | User-controlled values (Last.fm/stats.fm username, artist name, ids) flowing into outbound URLs — encoding, host pinning, redirect-following, timeouts, response-size caps. | `lib/statsfm-listened-artists.ts`, `lib/history/lastfm-syncer.ts`, `lib/music-provider/*`, `app/api/spotify/resolve-track`, `app/api/open/*`, `app/api/onboarding/search` |
| **E** | **DB / RPC / query-builder injection** | `.or()`/`.filter()`/`.ilike`/trigram search built from user input; `SECURITY DEFINER` RPCs (0020/0024/0026/0033/0034) for injection & privilege; param coercion. | `supabase/migrations/00{20,24,26,33,34}*.sql`, `app/api/onboarding/search`, `lib/recommendation/*` |
| **F** | **XSS / output encoding / CSP** | The two `dangerouslySetInnerHTML` sites (theme script in `layout.tsx`; DiceBear SVG in `identicon-avatar.tsx` — is the seed reflected raw?); hrefs/srcs from remote data; redirect targets; **absence of a Content-Security-Policy header**. | `app/layout.tsx`, `components/ui/identicon-avatar.tsx`, `next.config.ts` |
| **G** | **Secrets & configuration** | Service-role key never reaches client bundle; no secret-shaped `NEXT_PUBLIC_*`; `.env.example` is placeholders only; logging doesn't emit tokens/PII/secrets (note `[like]` logs token *state*); source maps off; generic client errors. Git history already cleared of `.env.local` (verified — only `.env.example` ever tracked). | `next.config.ts`, `.env.example`, all `console.*`, `lib/get-access-token.ts` |
| **H** | **Rate-limiting, DoS & cost** | Only login is rate-limited. Expensive endpoints (`recommendations/generate`, `explore/generate`, `onboarding/search`→Spotify, `history/accumulate`) — abuse → API-quota/cost exhaustion. Login limiter TOCTOU + `x-forwarded-for` bypass; cron-secret strength; unbounded request bodies. | `lib/rate-limiter.ts`, expensive routes, `app/api/cron/*` |
| **I** | **Dependencies & supply chain** | `npm audit`: 14 vulns (2 high, 12 moderate) — triage reachability; next-auth beta risk; lockfile integrity; lifecycle scripts; stray root files (`test-colour.js`). | `package.json`, `package-lock.json` |
| **J** | **Privacy / data-at-rest** | Verify the "only hashed username" claim against the real schema. HMAC-username reversibility (small charset + secret); envelope-encryption correctness & key handling; IP hashing; what music data is retained & whether deletion (`DELETE /api/account`) is complete. | `supabase/migrations/*`, `lib/crypto/username.ts`, `app/api/account` |
| **K** | **Headers / transport / cookies** | CSP (missing), HSTS, frame/nosniff (present); auth-cookie flags (Secure/HttpOnly/SameSite); `vercel.json`; `.well-known`. | `next.config.ts`, `proxy.ts`, `vercel.json` |

## 3. Methodology per finding

Each finding carries: **title · file:line · threat class · attacker & precondition · concrete exploit path · reachability (is it actually reachable in this app, given service-role + proxy gating?) · severity (user-affecting vs theoretical) · fix · does the fix cost functionality?**

Severity grading follows the honest-severity rule: lead with **reachability**, not just a scary tag. A theoretical bug behind an unreachable path is labelled as such.

## 4. Verification pass (anti-false-positive)

Every candidate finding is handed to an independent verifier prompted to **refute** it — confirm the source lines, the data flow, and reachability; default to "not a real, reachable, user-affecting issue" unless it can prove otherwise. Only survivors reach the report. (This is why the `.env.local` scare was dropped before it ever entered the plan.)

## 5. Remediation protocol (the hard rule)

Findings are sorted: **Critical / High / Medium / Low / Informational.** For each fix:
- If it's a pure hardening change with **no functionality cost** → propose directly.
- If it **could remove or change a feature** (e.g. tightening CSRF on an endpoint a bookmarklet uses, rate-limiting a flow a power-user hammers, dropping a logging line used for triage, CSP breaking inline styles) → **STOP and surface as a decision, one at a time, with alternatives.** Never trade a feature for security silently.

## 6. Deliverable

A prioritized findings report + a remediation plan with per-item functionality-impact flags, fed into the project's issue tracker only after the human-in-loop review.

---
title: Auth & Session
updated: 2026-06-06
related: [[data-model]], [[api-routes]], [[infra-and-ops]]
---

# Auth & Session

flipside uses **NextAuth v5 (Auth.js) with a Credentials provider** — **username only**.
There is **no OAuth, no password, and Spotify is NOT the login** (a recurring
misconception — verify against `lib/auth.ts`). See [[spotify-dependency]].

## Login flow (`lib/auth.ts`)

1. Username accepted: 2–30 chars, `/^[a-z0-9._-]+$/`.
2. **Rate-limit by IP** via `lib/rate-limiter.ts` → `login_attempts` table, enforced
   atomically in DB (`rpc_register_login_attempt`, migration 0035) to avoid TOCTOU races
   across Vercel instances (10 attempts / 60s).
3. **HMAC the username**: `HMAC-SHA256(username, USERNAME_HMAC_SECRET)` → `username_hash`.
   The plaintext username is **never stored**; the hash is a one-way lookup key.
4. **Upsert** the `users` row; return `{ id: UUID }`.
5. **JWT callback** stores the UUID as `token.sub`; **session callback** copies it to
   `session.user.id`. Strategy is `"jwt"` (signed cookie, not DB sessions).
6. Cookie: `authjs.session-token` / `__Secure-authjs.session-token`. The JWT holds only
   the UUID — **no Spotify tokens**.

`safeAuth()` wraps `auth()` and catches stale-cookie decryption errors (deletes the bad
cookie instead of throwing).

## The Spotify user token (optional, separate from login)

Some users connect Spotify for richer history. When present, the encrypted OAuth token
lives in the NextAuth JWT and is read server-side by `getAccessToken(req)`
(`lib/get-access-token.ts`); it returns `null` on `RefreshTokenError`. This token powers
only *connected-user extras* (history sync, like-a-track) and is **preferred** over the
shared client-credentials key during generation (`userAccessToken ?? clientToken`). See
[[external-apis]] and [[music-providers]].

## Username encryption at rest (`lib/crypto/username.ts`)

`lastfm_username` and `statsfm_username` columns are encrypted with **AES-256-GCM**
(12-byte IV, 16-byte tag, base64, prefix `enc:v1:`), key from `USERNAME_ENCRYPTION_KEY`.
Idempotent (already-encrypted passes through). One-time backfill:
`scripts/encrypt-existing-usernames.ts`.

## Route protection

- **Middleware** (`proxy.ts`): gates all pages + `/api/*` except `/api/auth/*` and
  `/api/cron/*`. See [[infra-and-ops]].
- **API wrappers** (`lib/api/with-authed-route.ts`): three factories —
  `withAuthedRoute` (session only), `withAuthedCsrfRoute` (+CSRF), `withAuthedJsonRoute`
  (+CSRF +JSON parse). About half the routes inline the same pattern. See [[api-routes]].
- **CSRF** (`lib/csrf.ts`): `enforceSameOrigin` checks Origin → Referer →
  `Sec-Fetch-Site` against known origins (`AUTH_URL`, `NEXTAUTH_URL`,
  `NEXT_PUBLIC_APP_URL`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`). **Fails closed**
  in production when no origins configured.
- **Request-scoped user cache** (`lib/user-cache.ts`): `getCachedUser(userId)` is
  `React.cache()`-wrapped so the `users` row is fetched once per render pass.

## Supabase clients (`lib/supabase/`)

- `client.ts` — browser client (anon key).
- `server.ts` — `createClient()` (anon + cookie bridging for RSC/Server Actions) and
  `createServiceClient()` (service-role key, bypasses RLS) used for privileged writes
  (auth, cron, scripts). See [[data-model]].

## Account deletion

`DELETE /api/account` deletes the `users` row (cascades to all child tables) then signs
out. See [[api-routes]].

---
title: Auth & Session
updated: 2026-10-24
related: [[data-model]], [[api-routes]], [[infra-and-ops]]
---

# Auth & Session

flipside uses **NextAuth v5 (Auth.js) with a Credentials provider** — **username only**.
There is **no OAuth, no password, and Spotify is NOT the login** (a recurring
misconception — verify against `lib/auth.ts`). See [[spotify-dependency]].

## Login flow (`lib/auth.ts`, decisions in `lib/auth-sign-in.ts`)

The sign-in page (`app/(marketing)/sign-in/page.tsx`) has two explicit modes, sent as the
`mode` credential (#175 D3). Default is **Existing account**; a missing or unknown `mode`
is treated as existing, so nothing ever creates an account by accident.

1. **Rate-limit** via `lib/rate-limiter.ts` → `login_attempts` table, enforced atomically in
   DB (`rpc_register_login_attempt`, migration 0035) to avoid TOCTOU races across Vercel
   instances. Three fixed 60s buckets, checked in order, stopping at the first full one
   (so an IP already blocked is not charged to the global bucket):
   - per IP: 10 (`sha256(ip)`, same key as before D3);
   - per network: 20 per IPv6 /64 (`sha256("net:<prefix>::/64")`). IPv4 has no separate
     network bucket: the address is the network (a /24 would mostly hit shared NAT ranges);
   - global: 300 across all sign-ins (key `global`). A friend group never reaches it; a
     distributed guesser can, which blocks everyone until the window rolls over.
   Each bucket **fails open** on a DB error. Both modes count. Exceeded → code `rate_limited`.
2. Username accepted: 2–30 chars, `/^[a-z0-9._-]+$/` (`normalizeUsername`).
3. **HMAC the username**: `HMAC-SHA256(username, USERNAME_HMAC_SECRET)` → `username_hash`.
   The plaintext username is **never stored**; the hash is a one-way lookup key.
4. `resolveSignIn(mode, hash, store)`:
   - **existing** → sign in if the hash exists; otherwise a generic `credentials` failure
     ("Couldn't sign in with that username."), identical for unknown and invalid names.
   - **new** → insert the `users` row if the hash is free; a taken name (including a
     concurrent insert hitting `users_username_hash_key`) fails with code `username_taken`.
     This reveals that a name exists; accepted trade-off.
   Codes reach the client as `signIn(...).code` (custom `CredentialsSignin` subclasses).
5. **JWT callback** stores the UUID as `token.sub`; **session callback** copies it to
   `session.user.id`. Strategy is `"jwt"` (signed cookie, not DB sessions).
6. Cookie: `authjs.session-token` / `__Secure-authjs.session-token`. The JWT holds only
   the UUID — **no Spotify tokens**.

`safeAuth()` wraps `auth()` and catches stale-cookie decryption errors (deletes the bad
cookie instead of throwing).

## No Spotify user token

There is **no per-user Spotify token**. Login is Credentials-only, so nothing ever wrote an
`accessToken` into the JWT. The dead reader (`lib/get-access-token.ts`) and the routes that
depended on it (`/api/spotify/like`, `/api/spotify/resolve-track`, the save→playlist branch
of `/api/saves`) were deleted in #175 (restore tag `archive/spotify-user-token`). All
server-side Spotify calls use the shared client-credentials token
(`lib/spotify-client-token.ts`), or `""` (Spotify-free) when it is unavailable. The
`users.flipside_playlist_id` / `spotify_id` columns remain but are unused. See
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
  (+CSRF +JSON parse), each passing `{ userId, request, supabase }`; plus `withCronRoute` for
  the `CRON_SECRET` gate on `/api/cron/*`. A few routes still inline the preamble. See [[api-routes]].
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

import { createHmac, timingSafeEqual } from "crypto"
import { safeAuth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { enforceSameOrigin } from "@/lib/csrf"
import { createServiceClient } from "@/lib/supabase/server"

// ─── Shared context types ─────────────────────────────────────────────────────

export type ServiceClient = ReturnType<typeof createServiceClient>

export interface AuthedContext {
  userId: string
  request: Request
  /**
   * Service-role Supabase client, created lazily on first access (one per
   * request). Tests mock `@/lib/supabase/server` to hand routes a fake.
   */
  readonly supabase: ServiceClient
}

function authedContext(userId: string, request: Request): AuthedContext {
  let client: ServiceClient | undefined
  return {
    userId,
    request,
    get supabase() {
      return (client ??= createServiceClient())
    },
  }
}

export interface AuthedJsonContext extends AuthedContext {
  body: unknown
}

// ─── withAuthedRoute ──────────────────────────────────────────────────────────
//
// Auth-only wrapper (no CSRF check, no body parsing). Use for routes that are
// protected solely by the session cookie — typically idempotent GETs, or
// mutating routes that handle CSRF via a different mechanism.

export function withAuthedRoute<TArgs extends unknown[]>(
  handler: (ctx: AuthedContext, ...rest: TArgs) => Promise<Response>,
): (request: Request, ...rest: TArgs) => Promise<Response> {
  return async (request: Request, ...rest: TArgs): Promise<Response> => {
    const session = await safeAuth()
    if (!session?.user?.id) return apiUnauthorized()

    return handler(authedContext(session.user.id, request), ...rest)
  }
}

// ─── withAuthedCsrfRoute ──────────────────────────────────────────────────────
//
// CSRF + auth wrapper without body parsing. Use for mutating routes (DELETE,
// PATCH, etc.) that enforce same-origin but do not expect a JSON body.

export function withAuthedCsrfRoute<TArgs extends unknown[]>(
  handler: (ctx: AuthedContext, ...rest: TArgs) => Promise<Response>,
): (request: Request, ...rest: TArgs) => Promise<Response> {
  return async (request: Request, ...rest: TArgs): Promise<Response> => {
    const blocked = enforceSameOrigin(request)
    if (blocked) return blocked

    const session = await safeAuth()
    if (!session?.user?.id) return apiUnauthorized()

    return handler(authedContext(session.user.id, request), ...rest)
  }
}

// ─── withAuthedJsonRoute ──────────────────────────────────────────────────────
//
// CSRF + auth + JSON body wrapper. Use for mutating routes that expect a JSON
// request body (POST, PUT, PATCH). Returns 400 "Invalid JSON" if the body
// cannot be parsed.

export function withAuthedJsonRoute<TArgs extends unknown[]>(
  handler: (ctx: AuthedJsonContext, ...rest: TArgs) => Promise<Response>,
): (request: Request, ...rest: TArgs) => Promise<Response> {
  return async (request: Request, ...rest: TArgs): Promise<Response> => {
    const blocked = enforceSameOrigin(request)
    if (blocked) return blocked

    const session = await safeAuth()
    if (!session?.user?.id) return apiUnauthorized()

    const body = await request.json().catch(() => null)
    if (body === null) return apiError("Invalid JSON", 400)

    return handler(Object.assign(authedContext(session.user.id, request), { body }), ...rest)
  }
}

// ─── withCronRoute ────────────────────────────────────────────────────────────
//
// CRON_SECRET gate for /api/cron/* (excluded from middleware auth, so this is
// the ONLY gate). 500 "Server misconfigured" when the secret is unset; 401
// unless `Authorization: Bearer <CRON_SECRET>`. Both values are HMAC'd to
// fixed-length digests before timingSafeEqual — no length leak.

export interface CronContext {
  request: Request
  readonly supabase: ServiceClient
}

export function withCronRoute(
  tag: string,
  handler: (ctx: CronContext) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      console.error(`[${tag}] CRON_SECRET is not set — refusing request`)
      return apiError("Server misconfigured", 500)
    }
    const authHeader = request.headers.get("authorization") ?? ""
    const hmac = (v: string) => createHmac("sha256", "cron-compare").update(v).digest()
    if (!timingSafeEqual(hmac(authHeader), hmac(`Bearer ${cronSecret}`))) {
      return apiUnauthorized()
    }
    let client: ServiceClient | undefined
    return handler({
      request,
      get supabase() {
        return (client ??= createServiceClient())
      },
    })
  }
}

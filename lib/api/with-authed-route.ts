import { safeAuth } from "@/lib/auth"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { enforceSameOrigin } from "@/lib/csrf"

// ─── Shared context types ─────────────────────────────────────────────────────

export interface AuthedContext {
  userId: string
  request: Request
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

    const userId = session.user.id
    return handler({ userId, request }, ...rest)
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

    const userId = session.user.id
    return handler({ userId, request }, ...rest)
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

    const userId = session.user.id
    const body = await request.json().catch(() => null)
    if (body === null) return apiError("Invalid JSON", 400)

    return handler({ userId, request, body }, ...rest)
  }
}

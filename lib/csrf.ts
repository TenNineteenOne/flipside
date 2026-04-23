import { apiError } from "@/lib/errors"

/**
 * Same-origin guard for mutating API routes. Protects against CSRF where an
 * attacker on an external origin tricks a logged-in user's browser into
 * firing a state-changing request against us with the auth cookie attached.
 *
 * Accept rule: the request's `Origin` (or `Referer`, as fallback for clients
 * that strip `Origin`) must match one of the known app origins. Unset Origin
 * with `Sec-Fetch-Site: same-origin` is also accepted — covers native fetch
 * from our own pages when stripped by a proxy. Everything else is rejected.
 *
 * Known origins come from `AUTH_URL` / `NEXTAUTH_URL` and
 * `NEXT_PUBLIC_APP_URL` plus, in development, 127.0.0.1 / localhost.
 */

function knownOrigins(): Set<string> {
  const origins = new Set<string>()
  const add = (raw: string | undefined) => {
    if (!raw) return
    try {
      origins.add(new URL(raw).origin)
    } catch {
      // Ignore malformed env values so a bad config doesn't 403 every request.
    }
  }
  add(process.env.AUTH_URL)
  add(process.env.NEXTAUTH_URL)
  add(process.env.NEXT_PUBLIC_APP_URL)
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000")
    origins.add("http://127.0.0.1:3000")
  }
  return origins
}

export function isSameOrigin(request: Request): boolean {
  const allowed = knownOrigins()
  if (allowed.size === 0) return true // No config → fail open in dev/preview.

  const origin = request.headers.get("origin")
  if (origin) return allowed.has(origin)

  // Some clients (older Safari, server-side fetch) omit Origin. Fall back to
  // Referer and, as a last resort, the Sec-Fetch-Site signal emitted by all
  // modern browsers for fetch/XHR navigation.
  const referer = request.headers.get("referer")
  if (referer) {
    try {
      if (allowed.has(new URL(referer).origin)) return true
    } catch {
      // malformed referer — fall through
    }
  }

  return request.headers.get("sec-fetch-site") === "same-origin"
}

/**
 * Call at the top of every mutating route. Returns a 403 `Response` when the
 * request fails the same-origin check, otherwise `null`. Usage:
 *
 *     const blocked = enforceSameOrigin(request)
 *     if (blocked) return blocked
 */
export function enforceSameOrigin(request: Request): Response | null {
  if (isSameOrigin(request)) return null
  const origin = request.headers.get("origin") ?? "(none)"
  const referer = request.headers.get("referer") ?? "(none)"
  console.log(`[csrf] blocked origin=${origin} referer=${referer}`)
  return apiError("Cross-origin request rejected", 403)
}


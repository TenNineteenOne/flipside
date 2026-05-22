/**
 * Tests for withAuthedRoute, withAuthedCsrfRoute, and withAuthedJsonRoute.
 *
 * Environment: node (no DOM). Dependencies on @/lib/auth, @/lib/csrf, and
 * @/lib/errors are mocked so we exercise only the wrapper logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  withAuthedRoute,
  withAuthedCsrfRoute,
  withAuthedJsonRoute,
} from "./with-authed-route"

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth", () => ({
  safeAuth: vi.fn(),
}))

vi.mock("@/lib/csrf", () => ({
  enforceSameOrigin: vi.fn(),
}))

// Use real error helpers — they are pure and have no side effects.
vi.mock("@/lib/errors", async (importOriginal) => {
  return await importOriginal<typeof import("@/lib/errors")>()
})

import { safeAuth } from "@/lib/auth"
import { enforceSameOrigin } from "@/lib/csrf"

const mockSafeAuth = vi.mocked(safeAuth)
const mockEnforceSameOrigin = vi.mocked(enforceSameOrigin)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body?: string): Request {
  return new Request("https://example.com/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body } : {}),
  })
}

function sessionWith(id: string) {
  return { user: { id } } as Awaited<ReturnType<typeof safeAuth>>
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: CSRF passes (enforceSameOrigin returns null)
  mockEnforceSameOrigin.mockReturnValue(null)
  // Default: no session
  mockSafeAuth.mockResolvedValue(null)
})

// ─── withAuthedRoute ──────────────────────────────────────────────────────────

describe("withAuthedRoute", () => {
  it("returns 401 and does NOT call handler when session is missing", async () => {
    mockSafeAuth.mockResolvedValue(null)
    const handler = vi.fn()
    const wrapped = withAuthedRoute(handler)

    const res = await wrapped(makeRequest())

    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it("calls handler once with { userId, request } when session is present", async () => {
    mockSafeAuth.mockResolvedValue(sessionWith("user-abc"))
    const handler = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }))
    const wrapped = withAuthedRoute(handler)
    const req = makeRequest()

    await wrapped(req)

    expect(handler).toHaveBeenCalledOnce()
    const [ctx] = handler.mock.calls[0] as [{ userId: string; request: Request }]
    expect(ctx.userId).toBe("user-abc")
    expect(ctx.request).toBe(req)
  })

  it("forwards rest args (e.g. route params) to the handler", async () => {
    mockSafeAuth.mockResolvedValue(sessionWith("user-xyz"))
    const handler = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }))
    const wrapped = withAuthedRoute(handler)
    const req = makeRequest()
    const routeCtx = { params: Promise.resolve({ id: "x" }) }

    await wrapped(req, routeCtx)

    expect(handler).toHaveBeenCalledOnce()
    const [, passedCtx] = handler.mock.calls[0] as [unknown, typeof routeCtx]
    expect(passedCtx).toBe(routeCtx)
  })

  it("returns the handler's Response directly", async () => {
    mockSafeAuth.mockResolvedValue(sessionWith("user-1"))
    const expected = new Response("custom", { status: 202 })
    const handler = vi.fn().mockResolvedValue(expected)
    const wrapped = withAuthedRoute(handler)

    const res = await wrapped(makeRequest())

    expect(res).toBe(expected)
  })
})

// ─── withAuthedCsrfRoute ──────────────────────────────────────────────────────

describe("withAuthedCsrfRoute", () => {
  it("returns 403 and does NOT call handler or auth when CSRF blocks", async () => {
    const blocked = new Response(JSON.stringify({ error: "Cross-origin request rejected" }), {
      status: 403,
    })
    mockEnforceSameOrigin.mockReturnValue(blocked)
    const handler = vi.fn()
    const wrapped = withAuthedCsrfRoute(handler)

    const res = await wrapped(makeRequest())

    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
    expect(mockSafeAuth).not.toHaveBeenCalled()
  })

  it("returns 401 and does NOT call handler when CSRF passes but session is missing", async () => {
    mockEnforceSameOrigin.mockReturnValue(null)
    mockSafeAuth.mockResolvedValue(null)
    const handler = vi.fn()
    const wrapped = withAuthedCsrfRoute(handler)

    const res = await wrapped(makeRequest())

    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it("calls handler with { userId, request } when CSRF passes and session is present", async () => {
    mockEnforceSameOrigin.mockReturnValue(null)
    mockSafeAuth.mockResolvedValue(sessionWith("user-csrf"))
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const wrapped = withAuthedCsrfRoute(handler)
    const req = makeRequest()

    await wrapped(req)

    expect(handler).toHaveBeenCalledOnce()
    const [ctx] = handler.mock.calls[0] as [{ userId: string; request: Request }]
    expect(ctx.userId).toBe("user-csrf")
    expect(ctx.request).toBe(req)
  })

  it("forwards rest args (route params) to the handler", async () => {
    mockEnforceSameOrigin.mockReturnValue(null)
    mockSafeAuth.mockResolvedValue(sessionWith("user-csrf-2"))
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const wrapped = withAuthedCsrfRoute(handler)
    const req = makeRequest()
    const routeCtx = { params: Promise.resolve({ artistId: "abc" }) }

    await wrapped(req, routeCtx)

    const [, passedCtx] = handler.mock.calls[0] as [unknown, typeof routeCtx]
    expect(passedCtx).toBe(routeCtx)
  })
})

// ─── withAuthedJsonRoute ──────────────────────────────────────────────────────

describe("withAuthedJsonRoute", () => {
  it("returns 403 and does NOT call handler or auth when CSRF blocks", async () => {
    const blocked = new Response(JSON.stringify({ error: "Cross-origin request rejected" }), {
      status: 403,
    })
    mockEnforceSameOrigin.mockReturnValue(blocked)
    const handler = vi.fn()
    const wrapped = withAuthedJsonRoute(handler)

    const res = await wrapped(makeRequest('{"a":1}'))

    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
    expect(mockSafeAuth).not.toHaveBeenCalled()
  })

  it("returns 401 and does NOT call handler when CSRF passes but auth is missing", async () => {
    mockEnforceSameOrigin.mockReturnValue(null)
    mockSafeAuth.mockResolvedValue(null)
    const handler = vi.fn()
    const wrapped = withAuthedJsonRoute(handler)

    const res = await wrapped(makeRequest('{"a":1}'))

    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it("returns 400 Invalid JSON when the body cannot be parsed", async () => {
    mockEnforceSameOrigin.mockReturnValue(null)
    mockSafeAuth.mockResolvedValue(sessionWith("user-json"))
    const handler = vi.fn()
    const wrapped = withAuthedJsonRoute(handler)

    // Send a request with invalid JSON
    const req = new Request("https://example.com/api/test", {
      method: "POST",
      body: "not-json",
      headers: { "Content-Type": "application/json" },
    })
    const res = await wrapped(req)

    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toBe("Invalid JSON")
    expect(handler).not.toHaveBeenCalled()
  })

  it("calls handler with { userId, request, body } on the valid happy path", async () => {
    mockEnforceSameOrigin.mockReturnValue(null)
    mockSafeAuth.mockResolvedValue(sessionWith("user-happy"))
    const handler = vi.fn().mockResolvedValue(Response.json({ success: true }))
    const wrapped = withAuthedJsonRoute(handler)
    const payload = { spotifyArtistId: "abc123", signal: "thumbs_up" }
    const req = makeRequest(JSON.stringify(payload))

    await wrapped(req)

    expect(handler).toHaveBeenCalledOnce()
    const [ctx] = handler.mock.calls[0] as [
      { userId: string; request: Request; body: unknown },
    ]
    expect(ctx.userId).toBe("user-happy")
    expect(ctx.request).toBe(req)
    expect(ctx.body).toEqual(payload)
  })
})

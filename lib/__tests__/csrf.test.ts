import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { isSameOrigin, enforceSameOrigin } from "../csrf"

function makeRequest(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/whatever", {
    method: "POST",
    headers,
  })
}

describe("isSameOrigin", () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    process.env.AUTH_URL = "http://127.0.0.1:3000"
    process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3000"
    ;(process.env as Record<string, string>).NODE_ENV = "development"
  })

  afterEach(() => {
    process.env = { ...savedEnv }
  })

  it("accepts matching Origin header", () => {
    expect(isSameOrigin(makeRequest({ origin: "http://127.0.0.1:3000" }))).toBe(true)
    expect(isSameOrigin(makeRequest({ origin: "http://localhost:3000" }))).toBe(true)
  })

  it("rejects mismatched Origin header", () => {
    expect(isSameOrigin(makeRequest({ origin: "https://evil.example" }))).toBe(false)
    expect(isSameOrigin(makeRequest({ origin: "http://127.0.0.1:4000" }))).toBe(false)
  })

  it("falls back to Referer when Origin is absent", () => {
    expect(isSameOrigin(makeRequest({ referer: "http://127.0.0.1:3000/settings" }))).toBe(true)
    expect(isSameOrigin(makeRequest({ referer: "https://evil.example/x" }))).toBe(false)
  })

  it("falls back to Sec-Fetch-Site when Origin and Referer are absent", () => {
    expect(isSameOrigin(makeRequest({ "sec-fetch-site": "same-origin" }))).toBe(true)
    expect(isSameOrigin(makeRequest({ "sec-fetch-site": "cross-site" }))).toBe(false)
  })

  it("rejects a request with no origin, no referer, no sec-fetch-site", () => {
    expect(isSameOrigin(makeRequest({}))).toBe(false)
  })

  describe("request-host self-origin (Vercel branch aliases, custom domains)", () => {
    const BRANCH_HOST = "flipside-git-fix-abc123-team.vercel.app"

    beforeEach(() => {
      // Preview-deployment shape: env allowlist knows the prod URL and the
      // unique deployment URL, but NOT the git-branch alias being browsed.
      ;(process.env as Record<string, string>).NODE_ENV = "production"
      process.env.AUTH_URL = "https://flipside.example"
      process.env.NEXT_PUBLIC_APP_URL = "https://flipside.example"
      process.env.VERCEL_URL = "flipside-456k1mzns-team.vercel.app"
    })

    it("accepts Origin matching the host the request arrived on", () => {
      const req = new Request(`https://${BRANCH_HOST}/api/whatever`, {
        method: "POST",
        headers: { origin: `https://${BRANCH_HOST}`, "x-forwarded-host": BRANCH_HOST },
      })
      expect(isSameOrigin(req)).toBe(true)
    })

    it("still rejects a foreign Origin even when the host header is ours", () => {
      const req = new Request(`https://${BRANCH_HOST}/api/whatever`, {
        method: "POST",
        headers: { origin: "https://evil.example", "x-forwarded-host": BRANCH_HOST },
      })
      expect(isSameOrigin(req)).toBe(false)
    })

    it("rejects an http Origin for the same host in production (scheme pinned)", () => {
      const req = new Request(`https://${BRANCH_HOST}/api/whatever`, {
        method: "POST",
        headers: { origin: `http://${BRANCH_HOST}`, "x-forwarded-host": BRANCH_HOST },
      })
      expect(isSameOrigin(req)).toBe(false)
    })

    it("accepts a Referer on the request's own host when Origin is absent", () => {
      const req = new Request(`https://${BRANCH_HOST}/api/whatever`, {
        method: "POST",
        headers: { referer: `https://${BRANCH_HOST}/feed`, "x-forwarded-host": BRANCH_HOST },
      })
      expect(isSameOrigin(req)).toBe(true)
    })
  })
})

describe("enforceSameOrigin", () => {
  beforeEach(() => {
    process.env.AUTH_URL = "http://127.0.0.1:3000"
    process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3000"
    ;(process.env as Record<string, string>).NODE_ENV = "development"
  })

  it("returns null for same-origin requests", () => {
    expect(enforceSameOrigin(makeRequest({ origin: "http://127.0.0.1:3000" }))).toBeNull()
  })

  it("returns a 403 Response for cross-origin requests", async () => {
    const res = enforceSameOrigin(makeRequest({ origin: "https://evil.example" }))
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    const body = await res!.json()
    expect(body).toEqual({ error: "Cross-origin request rejected" })
  })
})

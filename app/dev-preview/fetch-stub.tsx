"use client"

/**
 * Dev-preview only: answers same-origin /api/* calls locally so the real hooks
 * succeed without auth or a database. Installed at module load (before any
 * component effect can fetch). Every stubbed call is logged.
 */
function respond(method: string, path: string): unknown {
  if (path === "/api/recommendations" && method === "GET") return { recommendations: [] }
  if (path === "/api/recommendations/generate") return { count: 0, pending: false }
  if (/^\/api\/artists\/[^/]+\/tracks$/.test(path)) return { tracks: [] }
  return {} // feedback, saves, dismiss, settings, explore preload, …
}

if (typeof window !== "undefined" && !("__devPreviewFetch" in window)) {
  const realFetch = window.fetch.bind(window)
  Object.assign(window, { __devPreviewFetch: true })
  window.fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init)
    const body = respond(req.method, url.pathname)
    const sent = req.method === "GET" ? "" : await req.text()
    console.info("[dev-preview]", req.method, url.pathname + url.search, sent, "→ 200", body)
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
  }
}

export function FetchStub() {
  return null
}

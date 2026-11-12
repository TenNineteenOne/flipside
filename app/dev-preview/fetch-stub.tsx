"use client"

/**
 * Dev-preview only: answers same-origin /api/* calls locally so the real hooks
 * succeed without auth or a database. Installed at module load (before any
 * component effect can fetch). Every stubbed call is logged.
 */
import { previewArtists } from "@/lib/dev-preview/fixtures"

/**
 * `/dev-preview/feed?start=N`: the page renders the first N fixtures and the
 * "server" holds exactly those; each generate writes the next BATCH, which
 * GET /api/recommendations then returns, so the real append path runs.
 * Without `start` the server has nothing new (GET returns []).
 * A regenerate (`?replace=true`) swaps the "server" list for the fixtures rotated by 5, so the swap shows.
 */
const BATCH = 6
const startParam = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("start")
let served: number | null = startParam === null ? null : Number(startParam)
let rotated: typeof previewArtists | null = null

function respond(method: string, path: string, search: string): unknown {
  if (path === "/api/recommendations" && method === "GET") {
    if (rotated) return { recommendations: rotated }
    return { recommendations: served === null ? [] : previewArtists.slice(0, served) }
  }
  if (path === "/api/recommendations/generate" && search.includes("replace=true")) {
    const from = rotated ?? previewArtists
    rotated = [...from.slice(5), ...from.slice(0, 5)]
    return { count: rotated.length, pending: false }
  }
  if (path === "/api/recommendations/generate") {
    // The empty-feed page waits (pending) instead of reporting "no artists".
    if (window.location.pathname === "/dev-preview/feed-empty") return { count: 0, pending: true }
    if (served === null || served >= previewArtists.length) return { count: 0, pending: false }
    const before = served
    served = Math.min(previewArtists.length, served + BATCH)
    return { count: served - before, pending: false }
  }
  if (/^\/api\/artists\/[^/]+\/tracks$/.test(path)) return { tracks: [] }
  return {} // feedback, saves, dismiss, settings, …
}

if (typeof window !== "undefined" && !("__devPreviewFetch" in window)) {
  const realFetch = window.fetch.bind(window)
  Object.assign(window, { __devPreviewFetch: true })
  window.fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init)
    const sent = req.method === "GET" ? "" : await req.text()
    // Generate takes a moment, like the real route, so "Generating…" is visible.
    if (url.pathname === "/api/recommendations/generate") await new Promise((r) => setTimeout(r, 1500))
    const body = respond(req.method, url.pathname, url.search)
    const recs = (body as { recommendations?: { id: string }[] }).recommendations
    const shown = recs ? `{ recommendations: ${recs.length} [${recs.map((r) => r.id).slice(-BATCH).join(", ")}] }` : JSON.stringify(body)
    console.info("[dev-preview]", req.method, url.pathname + url.search, sent, "→ 200", shown)
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
  }
}

export function FetchStub() {
  return null
}

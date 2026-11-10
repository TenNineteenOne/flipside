"use client"

/**
 * Dev-preview only: the Explore "server" on top of the shared fetch stub (imported first so it is
 * installed first; everything that is not Explore's falls through to it). Logs like the shared stub.
 *
 * - PATCH /api/settings remembers `adventurous` (the next build uses it).
 * - POST /api/explore/generate starts a new generation: generatedAt moves on and the rails rotate.
 *   `?gen=429` answers 429 (a build already running; the client polls as for a success),
 *   `?gen=500` answers 500 (the "Couldn't start rebuild" toast).
 * - GET /api/explore/rails returns the current generation.
 */
import "../fetch-stub"
import { PREVIEW_GENERATED_AT, previewRails } from "@/lib/dev-preview/explore-fixtures"

const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search)
const server = {
  adventurous: params?.get("adventurous") === "1",
  generation: 0,
  cold: params?.get("cold") === "1",
  generatedAt: params?.get("cold") === "1" ? null : (PREVIEW_GENERATED_AT as string | null),
}

if (typeof window !== "undefined" && window.location.pathname.startsWith("/dev-preview/explore") && !("__devPreviewExplore" in window)) {
  const inner = window.fetch
  Object.assign(window, { __devPreviewExplore: true })
  window.fetch = async (input, init) => {
    const req = new Request(input, init)
    const url = new URL(req.url, window.location.href)
    const path = url.pathname
    const ours = url.origin === window.location.origin &&
      (path === "/api/explore/rails" || path === "/api/explore/generate" || (path === "/api/settings" && req.method === "PATCH"))
    if (!ours) return inner(input, init)
    const sent = req.method === "GET" ? "" : await req.text()
    let status = 200
    let body: unknown = {}
    if (path === "/api/settings") {
      const patch = JSON.parse(sent || "{}") as { adventurous?: boolean }
      if (typeof patch.adventurous === "boolean") server.adventurous = patch.adventurous
    } else if (path === "/api/explore/generate") {
      await new Promise((r) => setTimeout(r, 600))
      const mode = params?.get("gen")
      if (mode === "500") status = 500
      else {
        if (mode === "429") status = 429
        server.cold = false
        server.generation++
        server.generatedAt = new Date().toISOString()
      }
      body = status === 200 ? { ok: true } : { error: status === 429 ? "cooldown" : "failed" }
    } else {
      const rails = previewRails({ adventurous: server.adventurous, generation: server.generation, cold: server.cold })
      body = { rails, generatedAt: server.generatedAt }
      const shown = `{ generation: ${server.generation}, rails: ${rails.map((r) => `${r.railKey}:${r.artists.length}`).join(" ")} }`
      console.info("[dev-preview]", req.method, path + url.search, sent, "→", status, shown)
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
    }
    console.info("[dev-preview]", req.method, path + url.search, sent, "→", status, JSON.stringify(body))
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  }
}

export function ExploreStub() {
  return null
}

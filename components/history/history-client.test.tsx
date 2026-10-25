import { describe, it, expect, vi } from "vitest"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { HistoryClient } from "./history-client"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

function entry(id: string, seenAt: string) {
  return {
    artist_id: id,
    artist_data: { id, name: `Artist ${id}`, genres: [], imageUrl: null, popularity: 0 },
    score: 0,
    why: { sourceArtists: [], genres: [], friendBoost: [] },
    seen_at: seenAt,
    signal: "thumbs_up",
    bookmarked: false,
  }
}

describe("#175 F12 history hydration", () => {
  it("server render contains no clock- or timezone-dependent time text", () => {
    const html = renderToString(
      createElement(HistoryClient, {
        history: [entry("a", new Date(Date.now() - 5 * 60_000).toISOString()), entry("b", "2026-01-15T03:00:00Z")],
      }),
    )
    expect(html).toContain("Artist a")
    expect(html).not.toMatch(/\dm ago|just now|Jan 1[45]/)
  })
})

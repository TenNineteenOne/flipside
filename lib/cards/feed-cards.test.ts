import { describe, it, expect } from "vitest"
import { assembleFeedCards } from "./feed-cards"
import { liftArtistColor } from "./card-artist"
import { resolveArtistColor, stringToVibrantHex } from "@/lib/color-utils"
import type { Track } from "@/lib/music-provider/types"
import type { UnseenRecommendation } from "@/lib/recommendation/feed-query"

function track(id: string, previewUrl: string | null = `https://p/${id}.m4a`): Track {
  return { id, spotifyTrackId: null, name: id, previewUrl, durationMs: 1, albumName: "A", albumImageUrl: null, source: "itunes" }
}

function row(id: string, data: Record<string, unknown> = {}, why: unknown = { sourceArtists: [], genres: [] }): UnseenRecommendation {
  return {
    artist_id: id,
    artist_data: { id, name: `N-${id}`, genres: ["g"], imageUrl: null, popularity: 10, topTracks: [track(`${id}t`)], ...data },
    score: 1,
    why,
  }
}

describe("assembleFeedCards", () => {
  it("lifts artist_data.artist_color to artistColor (null when absent)", () => {
    const [a, b] = assembleFeedCards([row("a", { artist_color: "#123456" }), row("b")], new Map())
    expect(a.artistColor).toBe("#123456")
    expect(b.artistColor).toBeNull()
  })

  it("falls back to artist_tracks_cache when no previews are baked", () => {
    const cached = [track("c1")]
    const [card] = assembleFeedCards([row("a", { topTracks: [] })], new Map([["a", cached]]))
    expect(card.topTracks).toBe(cached)
  })

  it("prefers baked previews over the tracks cache", () => {
    const [card] = assembleFeedCards([row("a")], new Map([["a", [track("other")]]]))
    expect(card.topTracks[0].id).toBe("at")
  })

  it("drops cards with no playable preview and rows missing id/name", () => {
    const cards = assembleFeedCards(
      [
        row("dead", { topTracks: [track("x", null)] }),
        row("none", { topTracks: undefined }),
        row("noname", { name: undefined }),
        row("ok"),
      ],
      new Map(),
    )
    expect(cards.map((c) => c.id)).toEqual(["ok"])
  })

  it("interleaves by primary source artist", () => {
    const why = (s: string) => ({ sourceArtists: [s], genres: [] })
    const cards = assembleFeedCards(
      [row("a1", {}, why("A")), row("a2", {}, why("A")), row("b1", {}, why("B")), row("c1", {}, null)],
      new Map(),
    )
    expect(cards.map((c) => c.id)).toEqual(["a1", "b1", "c1", "a2"])
    expect(cards[2].why).toEqual({ sourceArtists: [], genres: [] })
  })
})

describe("colour rules", () => {
  it("liftArtistColor ignores non-string values", () => {
    expect(liftArtistColor({ artist_color: 5 })).toBeNull()
    expect(liftArtistColor(null)).toBeNull()
  })

  it("the #8b5cf6 sentinel and null both resolve to the name hash", () => {
    expect(resolveArtistColor("#8b5cf6", "X")).toBe(stringToVibrantHex("X"))
    expect(resolveArtistColor(null, "X")).toBe(stringToVibrantHex("X"))
    expect(resolveArtistColor("#abcdef", "X")).toBe("#abcdef")
  })
})

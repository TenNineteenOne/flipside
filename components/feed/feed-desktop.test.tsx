import { describe, it, expect, vi } from "vitest"
import { renderToString } from "react-dom/server"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { AudioProvider } from "@/lib/audio-context"
import { useFeedTriage } from "@/lib/hooks/use-feed-triage"
import type { CardArtist } from "@/lib/cards/card-artist"
import { FeedDesktop } from "./feed-desktop"

function artist(id: string, name: string, imageUrl: string | null = `https://is1-ssl.mzstatic.com/${id}.jpg`): CardArtist {
  return {
    id,
    name,
    genres: ["dub", "kraut"],
    imageUrl,
    popularity: 40,
    artistColor: null,
    why: { sourceArtists: ["Khruangbin"], genres: [] },
    topTracks: [],
  }
}

function Desktop({ artists }: { artists: CardArtist[] }) {
  return <FeedDesktop triage={useFeedTriage(artists, "spotify")} />
}

// Text only: drop React's <!-- --> separators between adjacent text nodes.
const render = (artists: CardArtist[]) =>
  renderToString(<AudioProvider><Desktop artists={artists} /></AudioProvider>).replaceAll("<!-- -->", "")

describe("FeedDesktop server render", () => {
  it("shows the first artist in focus, the three triage labels and the count", () => {
    const html = render([artist("a", "Yin Yin"), artist("b", "Altın Gün"), artist("c", "Glass Beams")])
    const focus = html.slice(html.indexOf('aria-label="Selected artist"'))
    expect(focus).toContain("Yin Yin")
    expect(focus).not.toContain("Altın Gün")
    for (const label of ["Less like this", "Dismiss", "More like this"]) expect(html).toContain(label)
    expect(html).toMatch(/<strong>3<\/strong> of 3 left/)
    expect(html).toMatch(/aria-label="Select Yin Yin" aria-current="true"/)
  })

  it("an artist with no image and no tracks shows the letter panel, not an image", () => {
    const html = render([artist("z", "zola jesus", null)])
    expect(html).toContain('class="ev-card-art ev-letter" aria-hidden="true">Z<')
    expect(html).not.toContain("<img")
  })
})

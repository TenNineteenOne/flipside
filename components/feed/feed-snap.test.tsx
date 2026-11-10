import { describe, it, expect, vi } from "vitest"
import { renderToString } from "react-dom/server"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { AudioProvider } from "@/lib/audio-context"
import { useFeedTriage } from "@/lib/hooks/use-feed-triage"
import type { CardArtist } from "@/lib/cards/card-artist"
import { FeedSnap, SnapCount } from "./feed-snap"

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

function Snap({ artists }: { artists: CardArtist[] }) {
  const triage = useFeedTriage(artists, "spotify")
  return (
    <>
      <FeedSnap triage={triage} />
      {/* The count is portalled into the shell top bar, which a server render has no slot for. */}
      <SnapCount triage={triage} />
    </>
  )
}

const render = (artists: CardArtist[]) =>
  renderToString(<AudioProvider><Snap artists={artists} /></AudioProvider>).replaceAll("<!-- -->", "")

describe("FeedSnap server render", () => {
  const artists = [artist("a", "Yin Yin"), artist("b", "Altın Gün"), artist("c", "Glass Beams", null)]

  it("renders every artist as a page in order, the triage bar for the first, and the count", () => {
    const html = render(artists)
    const pages = [...html.matchAll(/<section class="ev-m-page" data-id="(\w)" aria-label="([^"]+)"/g)].map((m) => m[2])
    expect(pages).toEqual(["Yin Yin", "Altın Gün", "Glass Beams"])
    const bar = html.slice(html.indexOf('class="ev-m-triage"'))
    expect(bar).toContain('aria-label="Tell flipside what you think of Yin Yin"')
    for (const label of ["Less like this", "Dismiss", "More like this"]) expect(bar).toContain(`<span>${label}</span>`)
    expect(html).toContain("<strong>3</strong> of 3 left")
  })

  it("only the first artwork loads eagerly; an artist with no image gets the letter panel", () => {
    const html = render(artists)
    const imgs = html.match(/<img[^>]*>/g) ?? []
    expect(imgs).toHaveLength(2)
    expect(imgs[0]).toContain('loading="eager"')
    expect(imgs[1]).toContain('loading="lazy"')
    expect(html).toMatch(/class="ev-m-img ev-letter"[^>]*>G</)
  })
})

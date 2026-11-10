import { describe, it, expect, vi } from "vitest"
import { renderToString } from "react-dom/server"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { AudioProvider } from "@/lib/audio-context"
import { useFeedTriage } from "@/lib/hooks/use-feed-triage"
import { counts } from "@/lib/feed/triage-queue"
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

/** The real hook; `decided` overrides its signals (as the feedback hook's map would hold them). */
function Snap({ artists, decided, signalCount = 0 }: { artists: CardArtist[]; decided?: Map<string, string>; signalCount?: number }) {
  const t = useFeedTriage(artists, "spotify")
  const triage = decided
    ? { ...t, signals: decided, selectedId: null, selected: null, remaining: artists.filter((a) => !decided.has(a.id)).length, counts: counts(t.ids, decided) }
    : t
  return (
    <>
      <FeedSnap triage={triage} signalCount={signalCount} onLoadMore={() => {}} generating={false} />
      {/* The count is portalled into the shell top bar, which a server render has no slot for. */}
      <SnapCount triage={triage} />
    </>
  )
}

const render = (artists: CardArtist[], decided?: Map<string, string>, signalCount?: number) =>
  renderToString(<AudioProvider><Snap artists={artists} decided={decided} signalCount={signalCount} /></AudioProvider>).replaceAll("<!-- -->", "")

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

  it("decided cards stay in the scroll with their badges; the end page follows the last artist", () => {
    const html = render(artists, new Map([["a", "thumbs_up"], ["b", "thumbs_down"], ["c", "skip"]]))
    const pages = [...html.matchAll(/<section class="ev-m-page" data-id="([^"]+)"/g)].map((m) => m[1])
    expect(pages).toEqual(["a", "b", "c", "__end"])
    expect(html).toMatch(/data-v="liked"[\s\S]*class="ev-m-liked"[^>]*>.*?Liked</)
    expect(html).toMatch(/class="ev-m-judged">.*?Less like this</)
    expect(html).toMatch(/class="ev-m-judged">.*?Dismissed</)
    // A second copy beside the name, shown instead of the artwork's by feed.css on sideways (landscape) cards.
    expect(html).toMatch(/class="ev-m-name">Yin Yin<\/h2><span class="ev-m-liked ev-m-badge-side">/)
    expect(html).toMatch(/class="ev-m-judged ev-m-badge-side">.*?Dismissed</)
    expect(html).toContain("You’ve heard all 3.")
    expect(html).toContain("Load more artists")
    expect(html).toMatch(/class="ev-m-triage"[^>]*data-hidden="true"[^>]*inert=""/)
    expect(html).toContain("<strong>0</strong> of 3 left")
  })

  it("shows the cold-start line (with a dismiss button) until the listener has five signals", () => {
    expect(render(artists, undefined, 2)).toMatch(/class="ev-coldline"[\s\S]*Flipside signal · <span class="ev-cold-n">2 of 5<\/span>[\s\S]*aria-label="Hide signal hint"/)
    expect(render(artists, undefined, 5)).not.toContain("ev-coldline")
  })
})

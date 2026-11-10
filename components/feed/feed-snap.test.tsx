import { describe, it, expect, vi } from "vitest"
import { renderToString } from "react-dom/server"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { AudioProvider } from "@/lib/audio-context"
import { useFeedTriage } from "@/lib/hooks/use-feed-triage"
import { counts } from "@/lib/feed/triage-queue"
import type { CardArtist } from "@/lib/cards/card-artist"
import { FeedSnap, SnapCount } from "./feed-snap"
import { ChallengeSlot, type ChallengePayload } from "./challenge-strip"

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
function Snap({ artists, decided }: { artists: CardArtist[]; decided?: Map<string, string> }) {
  const t = useFeedTriage(artists, "spotify")
  const triage = decided
    ? { ...t, signals: decided, selectedId: null, selected: null, remaining: artists.filter((a) => !decided.has(a.id)).length, counts: counts(t.ids, decided) }
    : t
  return (
    <>
      <FeedSnap triage={triage} onLoadMore={() => {}} generating={false} wander={{ on: false, toggle: () => {} }} />
      {/* The count is portalled into the shell top bar, which a server render has no slot for. */}
      <SnapCount triage={triage} />
    </>
  )
}

const render = (artists: CardArtist[], decided?: Map<string, string>) =>
  renderToString(<AudioProvider><Snap artists={artists} decided={decided} /></AudioProvider>).replaceAll("<!-- -->", "")

describe("FeedSnap server render", () => {
  const artists = [artist("a", "Yin Yin"), artist("b", "Altın Gün"), artist("c", "Glass Beams", null)]

  it("renders every artist as a page in order, the triage bar for the first, and the count", () => {
    const html = render(artists)
    const pages = [...html.matchAll(/<section class="ev-m-page" data-id="(\w)" aria-label="([^"]+)"/g)].map((m) => m[2])
    expect(pages).toEqual(["Yin Yin", "Altın Gün", "Glass Beams"])
    const bar = html.slice(html.indexOf('class="ev-m-triage"'))
    expect(bar).toContain('aria-label="Tell flipside what you think of Yin Yin"')
    for (const label of ["Less like this", "Dismiss", "More like this"]) expect(bar).toContain(`<span>${label}</span>`)
    expect(html).toContain("<strong>3</strong><span class=\"ev-m-count-of\"> of 3</span> left")
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
    expect(html).toContain("<strong>0</strong><span class=\"ev-m-count-of\"> of 3</span> left")
  })
})

const settled = <T,>(value: T) => Object.assign(Promise.resolve(value), { status: "fulfilled", value })
const challenge: ChallengePayload = { description: "like 5 artists this week", progress: 2, target: 5, completed: false }

describe("FeedSnap weekly challenge", () => {
  const renderWith = (c: ChallengePayload | null) =>
    renderToString(
      <AudioProvider>
        <Phone challenge={<ChallengeSlot challengePromise={settled(c)} />} />
      </AudioProvider>,
    ).replaceAll("<!-- -->", "")
  function Phone({ challenge }: { challenge: React.ReactNode }) {
    const triage = useFeedTriage([artist("a", "Yin Yin")], "spotify")
    return <FeedSnap triage={triage} onLoadMore={() => {}} generating={false} wander={{ on: false, toggle: () => {} }} challenge={challenge} />
  }

  it("shows the strip as one line above the scroller, with no cold-start line", () => {
    const html = renderWith(challenge)
    const at = html.indexOf('<section aria-label="Weekly challenge" class="ev-chal">')
    expect(at).toBeGreaterThan(-1)
    expect(html).toContain('<span class="ev-chal-title">Weekly challenge</span>')
    expect(html).toMatch(/class="ev-chal-n">2\/5</)
    expect(html).not.toContain("Flipside signal")
    expect(at).toBeLessThan(html.indexOf('class="ev-m-snap"'))
  })

  it("renders nothing when there is no challenge", () => {
    expect(renderWith(null)).not.toContain("ev-chal")
  })
})

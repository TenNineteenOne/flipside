import { describe, it, expect, vi } from "vitest"
import { renderToString } from "react-dom/server"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { AudioProvider } from "@/lib/audio-context"
import { useFeedTriage } from "@/lib/hooks/use-feed-triage"
import { counts } from "@/lib/feed/triage-queue"
import type { CardArtist } from "@/lib/cards/card-artist"
import { FeedSnap } from "./feed-snap"
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
  return <FeedSnap triage={triage} onLoadMore={() => {}} generating={false} />
}

const render = (artists: CardArtist[], decided?: Map<string, string>) =>
  renderToString(<AudioProvider><Snap artists={artists} decided={decided} /></AudioProvider>).replaceAll("<!-- -->", "")

describe("FeedSnap server render", () => {
  const artists = [artist("a", "Yin Yin"), artist("b", "Altın Gün"), artist("c", "Glass Beams", null)]

  it("renders every artist as a page in order; each card holds art with the name, why, the six actions and its tracks note", () => {
    const html = render(artists)
    const pages = [...html.matchAll(/<section class="ev-m-page" data-id="(\w)" aria-label="([^"]+)"/g)].map((m) => m[2])
    expect(pages).toEqual(["Yin Yin", "Altın Gün", "Glass Beams"])
    expect(html).not.toContain("ev-m-triage")
    const card = html.slice(html.indexOf('data-id="a"'), html.indexOf('data-id="b"'))
    // name and genres over the artwork's lower edge, no play ring
    expect(card).toMatch(/class="ev-m-art">.*?<div class="ev-m-title"><h2 class="ev-m-name">Yin Yin<\/h2><p class="ev-m-genres">dub · kraut<\/p><\/div>/)
    expect(card).not.toContain("ev-m-play")
    const order = ["ev-m-art", "ev-m-why", "ev-card-actions", "ev-tracks-empty"].map((c) => card.indexOf(`class="${c}"`))
    expect(order.every((at, i) => at > -1 && (i === 0 || at > order[i - 1]))).toBe(true)
    const actions = card.slice(card.indexOf('class="ev-card-actions"'))
    for (const [name, label] of [["Less like this", "Less"], ["Skip this artist", "Skip"], ["More like this", "More"], ["Save for later", "Save"], ["Open in Spotify", "Spotify"], ["Share", "Share"]])
      expect(actions).toMatch(new RegExp(`aria-label="${name}"[^>]*>.*?<span>${label}</span>`))
    expect(card).toContain('<p class="ev-tracks-empty">Loading tracks…</p>')
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
    // The liked card's own More button reads as pressed.
    expect(html).toMatch(/aria-pressed="true" aria-label="Liked"[^>]*>.*?<span>Liked<\/span>/)
    expect(html).toContain("You’ve heard all 3.")
    expect(html).toContain(">Regenerate</button>")
  })

  it("the end page with Regenerate is there even while artists are unrated", () => {
    const html = render(artists, new Map([["a", "thumbs_up"]]))
    const pages = [...html.matchAll(/<section class="ev-m-page" data-id="([^"]+)"/g)].map((m) => m[1])
    expect(pages).toEqual(["a", "b", "c", "__end"])
    expect(html).toContain("2 not rated yet.")
    expect(html).toContain("Rate the rest")
    expect(html).toContain(">Regenerate</button>")
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
    return <FeedSnap triage={triage} onLoadMore={() => {}} generating={false} challenge={challenge} />
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

import { describe, it, expect, vi } from "vitest"
import { renderToString } from "react-dom/server"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { AudioProvider } from "@/lib/audio-context"
import { useFeedTriage, type FeedTriage } from "@/lib/hooks/use-feed-triage"
import { counts, visibleQueue } from "@/lib/feed/triage-queue"
import { tuning } from "@/lib/feed/tuning"
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

/** The real hook, optionally with every artist already decided (as the signals map would hold). */
function Desktop({ artists, decided }: { artists: CardArtist[]; decided?: Map<string, string> }) {
  const t = useFeedTriage(artists, "spotify")
  const triage: FeedTriage = decided
    ? {
        ...t,
        signals: decided,
        selectedId: null,
        selected: null,
        remaining: 0,
        counts: counts(t.ids, decided),
        tuning: tuning(artists, decided),
        visible: visibleQueue(t.ids, decided).map((id) => artists.find((a) => a.id === id)!),
      }
    : t
  return <FeedDesktop triage={triage} signalCount={10} onLoadMore={() => {}} generating={false} />
}

// Text only: drop React's <!-- --> separators between adjacent text nodes.
const render = (artists: CardArtist[], decided?: Map<string, string>) =>
  renderToString(<AudioProvider><Desktop artists={artists} decided={decided} /></AudioProvider>).replaceAll("<!-- -->", "")

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
    expect(html).toMatch(/class="ev-card-art ev-letter" style="background:#[0-9a-f]{6};color:#(ffffff|14121a)" aria-hidden="true">Z</)
    expect(html).not.toContain("<img")
  })

  it("renders the end state when every artist is decided", () => {
    const artists = [artist("a", "Yin Yin"), artist("b", "Altın Gün"), artist("c", "Glass Beams", null)]
    const html = render(artists, new Map([["a", "thumbs_up"], ["b", "thumbs_down"], ["c", "skip"]]))
    expect(html).toContain("You’ve heard all 3.")
    expect(html).toContain("1 liked, 1 less like this, 1 dismissed.")
    expect(html).toContain("Tomorrow’s batch leans toward <strong>dub and kraut</strong>.")
    expect(html).toContain("Load more artists")
    expect(html).toMatch(/<a[^>]*href="\/saved"[^>]*>Review saved<\/a>/)
    expect(html).toContain("<strong>0</strong> of 3 left")
  })
})

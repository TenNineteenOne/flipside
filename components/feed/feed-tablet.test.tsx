import { describe, it, expect, vi } from "vitest"
import { renderToString } from "react-dom/server"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { AudioProvider } from "@/lib/audio-context"
import { useFeedTriage } from "@/lib/hooks/use-feed-triage"
import { counts } from "@/lib/feed/triage-queue"
import type { CardArtist } from "@/lib/cards/card-artist"
import { FeedTablet } from "./feed-tablet"

function artist(id: string, name: string, imageUrl: string | null = `https://is1-ssl.mzstatic.com/${id}.jpg`): CardArtist {
  return { id, name, genres: [`${name} genre`], imageUrl, popularity: 40, artistColor: null, why: { sourceArtists: ["Khruangbin"], genres: [] }, topTracks: [] }
}

/** The real hook; `decided` overrides its signals, `selectedId` its selection (null = end of queue). */
function Tablet({ artists, decided, selectedId }: { artists: CardArtist[]; decided?: Map<string, string>; selectedId?: string | null }) {
  const t = useFeedTriage(artists, "spotify")
  const signals = decided ?? t.signals
  const sel = selectedId === undefined ? t.selectedId : selectedId
  const triage = {
    ...t,
    signals,
    selectedId: sel,
    selected: sel ? t.byId.get(sel) ?? null : null,
    remaining: artists.filter((a) => !signals.has(a.id)).length,
    counts: counts(t.ids, signals),
  }
  return <FeedTablet triage={triage} onLoadMore={() => {}} generating={false} wander={{ on: false, toggle: () => {} }} />
}

const render = (props: Parameters<typeof Tablet>[0]) =>
  renderToString(<AudioProvider><Tablet {...props} /></AudioProvider>).replaceAll("<!-- -->", "")

describe("FeedTablet server render", () => {
  const artists = [artist("a", "Yin Yin"), artist("b", "Altın Gün"), artist("c", "Glass Beams", null)]

  it("shows the selected artist's card with its own actions (no separate triage bar) and every artist in Up next with verdict marks", () => {
    const html = render({ artists, decided: new Map([["a", "thumbs_up"], ["b", "skip"]]), selectedId: "c" })
    expect(html).not.toContain("ev-m-triage")
    const stage = html.slice(html.indexOf('class="ev-m-stage"'), html.indexOf('class="ev-m-rail-wrap"'))
    expect(stage).toContain('<h2 class="ev-m-name">Glass Beams</h2>')
    expect(stage).not.toContain("ev-m-name\">Yin Yin")
    const actions = stage.slice(stage.indexOf('class="ev-card-actions"'))
    expect(actions).toContain('aria-label="Tell flipside what you think"')
    for (const label of ["Less", "Skip", "More", "Save", "Spotify", "Share"]) expect(actions).toContain(`<span>${label}</span>`)
    const rows = [...html.matchAll(/<button type="button" class="ev-m-thumb"([^>]*)>/g)].map((m) => m[1])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatch(/data-v="liked"[^>]*aria-label="Yin Yin, liked"/)
    expect(rows[1]).toMatch(/data-v="dismissed"[^>]*aria-label="Altın Gün, dismissed"/)
    expect(rows[2]).toMatch(/aria-current="true"[^>]*aria-label="Glass Beams"/)
    expect(html).toContain("class=\"ev-m-thumb-badge\"")
    expect(html).toContain("class=\"ev-m-thumb-x\"")
    // "Load more artists" is always the last item of Up next.
    expect(html).toMatch(/<li class="ev-m-rail-more"><button type="button" class="ev-btn ev-btn-ghost">Load more artists<\/button><button type="button" role="switch"[^>]*>[\s\S]*?<\/button><\/li><\/ol>/)
  })

  it("the end state takes the card's place when nothing is left", () => {
    const html = render({ artists, decided: new Map([["a", "thumbs_up"], ["b", "thumbs_down"], ["c", "skip"]]), selectedId: null })
    expect(html).not.toContain("ev-m-card")
    expect(html).toContain("You’ve heard all 3.")
    expect(html).not.toContain("ev-card-actions")
  })
})

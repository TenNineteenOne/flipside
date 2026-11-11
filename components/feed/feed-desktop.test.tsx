import { describe, it, expect, vi } from "vitest"
import { renderToString } from "react-dom/server"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { AudioProvider } from "@/lib/audio-context"
import { useFeedTriage, type FeedTriage } from "@/lib/hooks/use-feed-triage"
import { counts, visibleQueue } from "@/lib/feed/triage-queue"
import { tuning } from "@/lib/feed/tuning"
import type { CardArtist } from "@/lib/cards/card-artist"
import { FeedDesktop } from "./feed-desktop"
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

/** The real hook, optionally with every artist already decided (as the signals map would hold). */
function Desktop({ artists, decided, challenge }: { artists: CardArtist[]; decided?: Map<string, string>; challenge?: React.ReactNode }) {
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
  return <FeedDesktop triage={triage} onLoadMore={() => {}} generating={false} wander={{ on: false, toggle: () => {} }} challenge={challenge} />
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
    // "Load more artists" is always at the end of the queue column, not only in the end state.
    const queue = html.slice(html.indexOf('class="ev-queue"'), html.indexOf('class="ev-focus"'))
    expect(queue).toMatch(/class="ev-queue-more"><button type="button" class="ev-btn ev-btn-ghost">Load more artists<\/button><button type="button" role="switch"/)
  })

  it("labels the queue columns, and each row names its genre and popularity for screen readers", () => {
    const html = render([artist("a", "Yin Yin"), { ...artist("b", "Altın Gün"), genres: [], popularity: 0 }])
    const queue = html.slice(html.indexOf('class="ev-queue"'), html.indexOf('class="ev-focus"'))
    const cols = queue.slice(queue.indexOf('class="ev-cols"'), queue.indexOf('class="ev-rows"'))
    // the scale is visible text; the hint is said once (no title on the header or the rows)
    expect(cols).toMatch(/<span><\/span><span class="ev-col-genre">Genre<\/span><span class="ev-col-pop">Popularity <span class="ev-col-scale">0–100<\/span><span class="sr-only">. Lower means more obscure.<\/span>/)
    expect(queue).not.toMatch(/title="Popularity/)
    expect(queue).toContain('<span class="ev-row-genre" title="dub"><span class="sr-only">Genre: </span>dub</span>')
    expect(queue).toMatch(/<span class="sr-only">Popularity: <\/span>.*?<span class="ev-row-pop-n">40<\/span><span class="sr-only"> out of 100<\/span>/)
    // no genre: no dangling "Genre:"; popularity 0 still reads
    expect(queue).toContain('<span class="ev-row-genre"></span>')
    expect(queue).toMatch(/<span class="ev-row-pop-n">0<\/span><span class="sr-only"> out of 100<\/span>/)
  })

  it("hides the column labels when no rows are visible", () => {
    const html = render([])
    expect(html).toContain('class="ev-queue"')
    expect(html).not.toContain('class="ev-cols"')
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
    expect(html).not.toContain("Tomorrow")
    expect(html).toContain("Load more artists")
    expect(html).toMatch(/<a[^>]*href="\/saved"[^>]*>Review saved<\/a>/)
    expect(html).toContain("<strong>0</strong> of 3 left")
  })
})

describe("LoadMore", () => {
  it("stays focusable while generating: aria-disabled, not disabled, with the Generating label", async () => {
    const { LoadMore } = await import("./feed-parts")
    const busy = renderToString(<LoadMore onLoadMore={() => {}} generating wander={{ on: false, toggle: () => {} }} />)
    expect(busy).toContain('aria-disabled="true"')
    expect(busy).not.toMatch(/\sdisabled=""/)
    expect(busy).toContain("Generating…")
    expect(renderToString(<LoadMore onLoadMore={() => {}} generating={false} wander={{ on: false, toggle: () => {} }} />)).not.toContain("aria-disabled")
  })
})

describe("Wander farther", () => {
  const artists = [artist("a", "Yin Yin"), artist("b", "Altın Gün")]
  const renderWith = (on: boolean, decided?: Map<string, string>) =>
    renderToString(
      <AudioProvider><WanderDesktop artists={artists} on={on} decided={decided} /></AudioProvider>,
    ).replaceAll("<!-- -->", "")
  function WanderDesktop({ artists, on, decided }: { artists: CardArtist[]; on: boolean; decided?: Map<string, string> }) {
    const t = useFeedTriage(artists, "spotify")
    const triage: FeedTriage = decided
      ? { ...t, signals: decided, selectedId: null, selected: null, remaining: 0, counts: counts(t.ids, decided), tuning: tuning(artists, decided), visible: [] }
      : t
    return <FeedDesktop triage={triage} onLoadMore={() => {}} generating={false} wander={{ on, toggle: () => {} }} />
  }
  const switches = (html: string) => [...html.matchAll(/role="switch" aria-checked="(true|false)"/g)].map((m) => m[1])

  it("every switch (header, end of queue, end state) shows the one value", () => {
    const decided = new Map([["a", "skip"], ["b", "skip"]])
    expect(switches(renderWith(true, decided))).toEqual(["true", "true", "true"])
    expect(switches(renderWith(false, decided))).toEqual(["false", "false", "false"])
    expect(switches(renderWith(true))).toEqual(["true", "true"])
  })

  it("on: the Load more buttons go rainbow; off: not", () => {
    const on = renderWith(true)
    expect(on.match(/class="ev-btn [^"]*wander-btn-on"/g)).toHaveLength(2)
    expect(on).toMatch(/class="ev-btn ev-btn-primary wander-btn-on"[^>]*>Load more<\/button>/)
    const off = renderWith(false)
    expect(off).not.toContain("wander-btn-on")
  })

  it("a far pick's why-line reads Outside your usual, marked for the teal accent", () => {
    const far = { ...artist("f", "Far One"), why: { sourceArtists: ["Khruangbin"], genres: [], outsideUsual: "zouk" } }
    const html = renderToString(<AudioProvider><Desktop artists={[far]} /></AudioProvider>).replaceAll("<!-- -->", "")
    expect(html).toContain('<p class="ev-card-why" data-far="true">Outside your usual: zouk</p>')
    expect(html).toContain('<span class="ev-row-why" data-far="true">Outside your usual: zouk</span>')
    expect(html).not.toContain("Because you like")
  })
})

/** An already-settled promise: React's `use` reads it synchronously, so a server render shows the strip (or nothing). */
const settled = <T,>(value: T) => Object.assign(Promise.resolve(value), { status: "fulfilled", value })
const challenge: ChallengePayload = { description: "like 5 artists this week", progress: 2, target: 5, completed: false }
const renderWith = (c: ChallengePayload | null) =>
  renderToString(<AudioProvider><Desktop artists={[artist("a", "Yin Yin")]} challenge={<ChallengeSlot challengePromise={settled(c)} />} /></AudioProvider>).replaceAll("<!-- -->", "")

describe("FeedDesktop weekly challenge", () => {
  it("shows the strip in the header's Load more row, left of the controls, with no cold-start banner", () => {
    const html = renderWith(challenge)
    const strip = html.slice(html.indexOf('aria-label="Weekly challenge"'))
    const bar = html.slice(html.indexOf('class="ev-wander-bar"'), html.indexOf("</header>"))
    expect(bar.indexOf('aria-label="Weekly challenge"')).toBeGreaterThan(-1)
    expect(bar.indexOf('aria-label="Weekly challenge"')).toBeLessThan(bar.indexOf('class="ev-wander-ctl"'))
    expect(html).not.toContain("Flipside signal")
    expect(strip).toMatch(/<span class="ev-chal-title">Weekly challenge<\/span><span class="sr-only">:<\/span><span aria-hidden="true"> · <\/span>like 5 artists this week/)
    expect(strip).toMatch(/class="ev-chal-n">2\/5</)
    expect(strip.indexOf("ev-chal")).toBeLessThan(strip.indexOf('aria-label="Artist queue"'))
  })

  it("marks a completed challenge with a check", () => {
    const html = renderWith({ ...challenge, progress: 5, completed: true })
    expect(html).toMatch(/class="ev-chal" data-done="true"/)
    expect(html).toMatch(/class="ev-chal-n"><svg[^>]*lucide-check[\s\S]*?<\/svg>5\/5</)
  })

  it("renders nothing when there is no challenge (or it failed to load)", () => {
    expect(renderWith(null)).not.toContain("ev-chal")
  })
})

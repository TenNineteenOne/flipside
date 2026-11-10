import { describe, it, expect } from "vitest"
import { renderToString } from "react-dom/server"
import { statsEmpty, statsFull } from "@/lib/dev-preview/stats-fixtures"
import type { StatsData } from "@/app/(app)/stats/stats-data"
import { StatsClient } from "./stats-client"

const render = (s: StatsData) => renderToString(<StatsClient {...s} />).replaceAll("<!-- -->", "")
const text = (html: string) => html.replace(/<title>.*?<\/title>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

describe("StatsClient server render", () => {
  it("full account: every total, genre, both kinds, the chart's name and caption, and every artist once", () => {
    const html = render(statsFull)
    const t = text(html)
    for (const label of ["Discovered 248", "Saved 31", "Liked 57", "Passed 42"]) expect(t).toContain(label)
    for (const { genre, count } of statsFull.topGenres) expect(t).toContain(`${genre} ${count}`)
    expect(html).toContain('class="st shell-wide"')
    expect(html).toMatch(/<svg role="img" aria-label="Taste profile popularity distribution: 21 artists, median popularity \d+" aria-describedby="[^"]+"/)
    expect(html).toContain("<figcaption")
    // the saved+liked duplicate is shown once, as saved
    const dup = statsFull.savedArtists[1].name
    expect(html.split(`title="${dup}"`).length - 1).toBe(1)
    expect((html.match(/class="st-row"/g) ?? []).length).toBe(21)
    expect((html.match(/<circle/g) ?? []).length).toBe(21)
    for (const tick of [0, 20, 40, 60, 80, 100]) expect(html).toContain(`>${tick}</span>`)
    expect(html).not.toContain("uppercase")
    expect(html).not.toMatch(/style="[^"]*(color|font|padding|margin|background)/)
  })

  it("new account: totals still shown, both empty messages, the feed hint, and no chart", () => {
    const html = render(statsEmpty)
    const t = text(html)
    for (const label of ["Discovered 6", "Saved 0", "Liked 0", "Passed 0"]) expect(t).toContain(label)
    expect(t).toContain("Like some artists to see your top genres")
    expect(t).toContain("Save or like some artists to see where they fall on the popularity scale.")
    expect(html).toContain('href="/feed"')
    expect(html).not.toContain("<svg")
    expect(html).not.toContain("st-legend")
  })
})

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
    // table semantics: Popularity is the only sort control, its name starts with its visible text, aria-sort says the order
    expect(html).toContain('role="table"')
    expect((html.match(/role="columnheader"/g) ?? []).length).toBe(3)
    expect(html).toMatch(/role="columnheader" aria-sort="ascending"><button type="button" class="st-sort" aria-label="Popularity, sorted lowest first\. Activate to sort highest first\.">Popularity<svg/)
    expect((html.match(/<button/g) ?? []).length).toBe(1)
    const pops = [...html.matchAll(/class="st-row-pop st-n" role="cell" title="[^"]*">(\d+)</g)].map((m) => Number(m[1]))
    expect(pops).toEqual([...pops].sort((a, b) => a - b))
    expect(html).not.toContain("uppercase")
    expect(html).not.toMatch(/style="[^"]*(color|font|padding|margin|background)/)
  })

  it("new account: totals still shown, both empty messages, the feed hint, and no chart", () => {
    const html = render(statsEmpty)
    const t = text(html)
    for (const label of ["Discovered 6", "Saved 0", "Liked 0", "Passed 0"]) expect(t).toContain(label)
    expect(t).toContain("No likes yet.")
    expect(t).toContain("Nothing saved or liked yet.")
    expect(html).toContain('href="/feed"')
    expect(html).not.toContain("<svg")
    expect(html).not.toContain("st-legend")
  })
})

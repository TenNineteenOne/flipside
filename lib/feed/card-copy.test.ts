import { describe, it, expect } from "vitest"
import { formatDuration, listSeparator, popularityLabel, whyParts, whyText } from "./card-copy"

const lead = "Because you like "

describe("whyParts / whyText", () => {
  it("one source artist", () => {
    const why = { sourceArtists: ["A"], genres: ["g"] }
    expect(whyParts(why)).toEqual({ lead, names: ["A"], genres: [] })
    expect(whyText(why)).toBe("Because you like A")
  })

  it("two source artists", () => {
    const why = { sourceArtists: ["A", "B"], genres: [] }
    expect(whyParts(why)).toEqual({ lead, names: ["A", "B"], genres: [] })
    expect(whyText(why)).toBe("Because you like A and B")
  })

  it("three source artists", () => {
    const why = { sourceArtists: ["A", "B", "C"], genres: [] }
    expect(whyParts(why)).toEqual({ lead, names: ["A", "B", "C"], genres: [] })
    expect(whyText(why)).toBe("Because you like A, B and C")
  })

  it("genres only (0 source artists)", () => {
    const why = { sourceArtists: [], genres: ["shoegaze", "dream pop"] }
    expect(whyParts(why)).toEqual({ lead, names: [], genres: ["shoegaze", "dream pop"] })
    expect(whyText(why)).toBe("Because you like shoegaze, dream pop")
  })

  it("neither: no sentence", () => {
    const why = { sourceArtists: [], genres: [] }
    expect(whyParts(why)).toBeNull()
    expect(whyText(why)).toBeNull()
  })
})

describe("listSeparator", () => {
  it("joins as 'A, B and C'", () => {
    expect([0, 1, 2].map((i) => listSeparator(i, 3))).toEqual(["", ", ", " and "])
    expect([0, 1].map((i) => listSeparator(i, 2))).toEqual(["", " and "])
    expect(listSeparator(0, 1)).toBe("")
  })
})

describe("popularityLabel", () => {
  it.each([
    [0, "Barely charted"],
    [34, "Barely charted"],
    [35, "Deep cut"],
    [44, "Deep cut"],
    [45, "Under the radar"],
    [51, "Under the radar"],
    [52, "Cult following"],
    [100, "Cult following"],
  ])("%i is %s", (p, label) => {
    expect(popularityLabel(p)).toBe(label)
  })
})

describe("formatDuration", () => {
  it("formats m:ss", () => {
    expect(formatDuration(5_000)).toBe("0:05")
    expect(formatDuration(201_000)).toBe("3:21")
    expect(formatDuration(0)).toBe("0:00")
  })

  it("rounds to the nearest second without producing :60", () => {
    expect(formatDuration(59_600)).toBe("1:00")
    expect(formatDuration(200_400)).toBe("3:20")
  })
})

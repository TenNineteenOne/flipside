import { describe, it, expect } from "vitest"
import { formatDuration, listSeparator, popularityLabel, whyParts, whyText } from "./card-copy"

const lead = "Because you like "

describe("whyParts / whyText", () => {
  it("a far pick (outsideUsual) reads Outside your usual: <genre> instead of the normal why", () => {
    const why = { sourceArtists: ["A"], genres: ["g"], outsideUsual: "zouk" }
    expect(whyParts(why)).toEqual({ lead: "Outside your usual: ", names: [], genres: ["zouk"], far: true })
    expect(whyText(why)).toBe("Outside your usual: zouk")
    expect(whyParts({ sourceArtists: ["A"], genres: [], outsideUsual: "" })?.far).toBeUndefined()
  })

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
  })

  it("is empty for a missing, zero, negative or non-finite duration", () => {
    for (const ms of [0, -1, NaN, Infinity, -Infinity, undefined, null]) expect(formatDuration(ms)).toBe("")
  })

  it("renders hours as h:mm:ss", () => {
    expect(formatDuration(3_600_000)).toBe("1:00:00")
    expect(formatDuration(3_725_000)).toBe("1:02:05")
    expect(formatDuration(3_599_000)).toBe("59:59")
  })

  it("rounds to the nearest second without producing :60", () => {
    expect(formatDuration(59_600)).toBe("1:00")
    expect(formatDuration(200_400)).toBe("3:20")
  })
})

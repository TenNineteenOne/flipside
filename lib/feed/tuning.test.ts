import { describe, it, expect } from "vitest"
import { tuning } from "./tuning"

const a = (id: string, ...genres: string[]) => ({ id, genres })
const artists = [a("1", "dub", "funk"), a("2", "funk", "soul"), a("3", "jazz"), a("4", "rock", "pop", "folk", "metal", "emo")]

describe("tuning", () => {
  it("is empty with no decisions", () => {
    expect(tuning(artists, new Map())).toEqual({ more: [], less: [] })
  })

  it("liked genres lean toward, passed lean away, dismissed neither; deduped in feed order", () => {
    const s = new Map([["2", "thumbs_up"], ["1", "thumbs_up"], ["3", "thumbs_down"], ["4", "skip"]])
    expect(tuning(artists, s)).toEqual({ more: ["dub", "funk", "soul"], less: ["jazz"] })
  })

  it("caps at six toward and four away", () => {
    const all = (sig: string) => new Map(artists.map((x) => [x.id, sig]))
    expect(tuning(artists, all("thumbs_up")).more).toEqual(["dub", "funk", "soul", "jazz", "rock", "pop"])
    expect(tuning(artists, all("thumbs_down")).less).toEqual(["dub", "funk", "soul", "jazz"])
  })

  it("dedupes case-insensitively, keeping the first-seen casing", () => {
    const xs = [a("1", "Dub", "funk"), a("2", "dub", "FUNK", "Soul"), a("3", "jazz"), a("4", "JAZZ")]
    const s = new Map([["1", "thumbs_up"], ["2", "thumbs_up"], ["3", "thumbs_down"], ["4", "thumbs_down"]])
    expect(tuning(xs, s)).toEqual({ more: ["Dub", "funk", "Soul"], less: ["jazz"] })
  })

  it("never lists a genre under both; liked wins", () => {
    const xs = [a("1", "jazz", "dub"), a("2", "Dub", "Funk"), a("3", "funk")]
    const s = new Map([["1", "thumbs_down"], ["2", "thumbs_up"], ["3", "thumbs_down"]])
    expect(tuning(xs, s)).toEqual({ more: ["Dub", "Funk"], less: ["jazz"] })
  })
})

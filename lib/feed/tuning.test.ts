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
})

import { describe, expect, it } from "vitest"
import raw from "@/data/landing-sample.json"
import { validateLandingSample } from "./sample"

const clone = () => structuredClone(raw) as typeof raw

describe("validateLandingSample", () => {
  it("passes the shipped sample", () => {
    expect(validateLandingSample(raw)).toEqual([])
    expect(raw.artists).toHaveLength(6)
  })

  it("reports a disallowed image host", () => {
    const d = clone()
    d.artists[2].imageUrl = "https://evil.example.com/a.jpg"
    expect(validateLandingSample(d)).toEqual(["artists[2]: imageUrl disallowed host: evil.example.com"])
  })

  it("reports a disallowed audio host, including a lookalike suffix", () => {
    const d = clone()
    d.queue[0].tracks[1].previewUrl = "https://audio-ssl.itunes.apple.com.evil.com/x.m4a"
    expect(validateLandingSample(d)).toEqual(["queue[0] track 1: previewUrl disallowed host: audio-ssl.itunes.apple.com.evil.com"])
  })

  it("reports a URL with a port or userinfo", () => {
    const d = clone()
    const img = new URL(d.artists[0].imageUrl)
    d.artists[0].imageUrl = `https://${img.hostname}:8443${img.pathname}`
    d.artists[1].imageUrl = `https://user:pw@${img.hostname}${img.pathname}`
    d.artists[2].imageUrl = `https://user@${img.hostname}${img.pathname}`
    expect(validateLandingSample(d)).toEqual([
      "artists[0]: imageUrl has a port or credentials",
      "artists[1]: imageUrl has a port or credentials",
      "artists[2]: imageUrl has a port or credentials",
    ])
  })

  it("reports non-finite popularity and durationMs", () => {
    const d = clone()
    d.artists[0].popularity = NaN
    d.artists[1].popularity = Infinity
    d.artists[2].tracks[0].durationMs = Infinity
    d.artists[3].tracks[0].durationMs = NaN
    expect(validateLandingSample(d)).toEqual([
      "artists[0]: missing popularity",
      "artists[1]: missing popularity",
      "artists[2] track 0: missing durationMs",
      "artists[3] track 0: missing durationMs",
    ])
  })

  it("reports an artist with zero tracks", () => {
    const d = clone()
    d.artists[0].tracks = []
    expect(validateLandingSample(d)).toEqual(["artists[0]: no tracks"])
  })

  it("reports a missing preview and a missing field", () => {
    const d = clone() as unknown as { artists: Record<string, unknown>[] & { tracks: Record<string, unknown>[] }[] }
    delete d.artists[1].name
    delete d.artists[1].tracks[0].previewUrl
    expect(validateLandingSample(d)).toEqual(["artists[1]: missing name", "artists[1] track 0: previewUrl missing"])
  })

  it("reports empty lists and non-objects", () => {
    expect(validateLandingSample({ artists: [], queue: [] })).toEqual(["artists: empty list", "queue: empty list"])
    expect(validateLandingSample(null)).toEqual(["sample: not an object"])
  })
})

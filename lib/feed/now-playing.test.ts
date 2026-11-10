import { describe, it, expect } from "vitest"
import { isCurrentTrack, nowPlayingArtistId } from "./now-playing"

const t = (id: string) => ({ id })
// "a" and "b" share track "x" (a collaboration).
const artists = [{ id: "a", tracks: [t("x"), t("y")] }, { id: "b", tracks: [t("x")] }, { id: "c", tracks: [t("z")] }]

describe("nowPlayingArtistId", () => {
  it("is null when nothing is loaded", () => {
    expect(nowPlayingArtistId(null, { trackId: "x", artistId: "b" }, artists)).toBeNull()
  })
  it("uses the artist the feed started the track for, even when another artist shares it", () => {
    expect(nowPlayingArtistId("x", { trackId: "x", artistId: "b" }, artists)).toBe("b")
  })
  it("falls back to the track lookup when the feed did not start the current track", () => {
    expect(nowPlayingArtistId("z", { trackId: "x", artistId: "b" }, artists)).toBe("c")
    expect(nowPlayingArtistId("x", null, artists)).toBe("a")
  })
  it("falls back when the recorded artist is no longer loaded", () => {
    expect(nowPlayingArtistId("x", { trackId: "x", artistId: "gone" }, artists)).toBe("a")
  })
  it("is null for a track no loaded artist owns", () => {
    expect(nowPlayingArtistId("q", null, artists)).toBeNull()
  })
})

describe("isCurrentTrack", () => {
  it("marks a track current only on the artist the player is playing it for (a shared track shows once)", () => {
    const playing = nowPlayingArtistId("x", { trackId: "x", artistId: "b" }, artists)
    expect(isCurrentTrack(playing, "x", "b", "x")).toBe(true)
    expect(isCurrentTrack(playing, "x", "a", "x")).toBe(false)
    expect(isCurrentTrack(playing, "x", "b", "y")).toBe(false)
    expect(isCurrentTrack(null, null, "a", "x")).toBe(false)
  })
})

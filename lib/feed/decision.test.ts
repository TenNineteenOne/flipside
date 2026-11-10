import { describe, it, expect } from "vitest"
import { decide, type DecisionState } from "./decision"

const ids = ["a", "b", "c"]
const state = (over: Partial<DecisionState> = {}): DecisionState => ({
  ids,
  signals: new Map(),
  selectedId: "a",
  playingArtistId: null,
  ...over,
})
const req = (over: Partial<Parameters<typeof decide>[1]> = {}) => ({
  artistId: "a",
  name: "Alpha",
  signal: "thumbs_up" as const,
  toggle: true,
  advance: true,
  ...over,
})

describe("decide", () => {
  it.each([
    ["thumbs_up", "More like Alpha"],
    ["thumbs_down", "Less like Alpha"],
    ["skip", "Dismissed Alpha"],
  ] as const)("%s sends the signal, advances, and undoes back to undecided", (signal, message) => {
    expect(decide(state(), req({ signal }))).toEqual({
      send: { kind: "set", signal },
      selectId: "b",
      audio: { kind: "none" },
      undo: { artistId: "a", restore: undefined },
      message,
    })
  })

  it("advances against the signals as they will be after the decision, wrapping", () => {
    const s = state({ selectedId: "b", signals: new Map([["c", "thumbs_up"]]) })
    expect(decide(s, req({ artistId: "b", signal: "skip" })).selectId).toBe("a")
  })

  it("selects null when nothing is left", () => {
    const s = state({ signals: new Map([["b", "skip"], ["c", "thumbs_down"]]) })
    expect(decide(s, req({ signal: "thumbs_down" })).selectId).toBeNull()
  })

  it("does not advance when judging a non-selected artist", () => {
    const plan = decide(state({ selectedId: "b", playingArtistId: "c" }), req({ artistId: "c", signal: "thumbs_down" }))
    expect(plan.selectId).toBe("b")
    expect(plan.audio).toEqual({ kind: "none" })
    expect(plan.send).toEqual({ kind: "set", signal: "thumbs_down" })
  })

  it("does not advance when advance is false", () => {
    const plan = decide(state({ playingArtistId: "a" }), req({ advance: false }))
    expect(plan.selectId).toBe("a")
    expect(plan.audio).toEqual({ kind: "none" })
  })

  it("keeps playing: plays the next artist when the judged artist was playing", () => {
    expect(decide(state({ playingArtistId: "a" }), req()).audio).toEqual({ kind: "play", artistId: "b" })
  })

  it("keeps playing: pauses when the judged artist was playing and none are left", () => {
    const s = state({ playingArtistId: "a", signals: new Map([["b", "skip"], ["c", "skip"]]) })
    expect(decide(s, req({ signal: "skip" })).audio).toEqual({ kind: "pause" })
  })

  it("leaves audio alone when a different artist is playing", () => {
    expect(decide(state({ playingArtistId: "c" }), req()).audio).toEqual({ kind: "none" })
  })

  it("un-likes in place when toggling an already-liked artist", () => {
    const s = state({ signals: new Map([["a", "thumbs_up"]]), playingArtistId: "a" })
    expect(decide(s, req())).toEqual({
      send: { kind: "set", signal: "thumbs_up" },
      selectId: "a",
      audio: { kind: "none" },
      undo: null,
      message: "Removed like from Alpha",
    })
  })

  it("swipe-right (toggle false) on an already-liked artist is a no-op", () => {
    const s = state({ signals: new Map([["a", "thumbs_up"]]), playingArtistId: "a" })
    expect(decide(s, req({ toggle: false }))).toEqual({
      send: { kind: "none" },
      selectId: "a",
      audio: { kind: "none" },
      undo: null,
      message: "",
    })
  })

  it("passing an already-liked artist sends the new signal; undo restores the like", () => {
    const s = state({ signals: new Map([["a", "thumbs_up"]]) })
    const plan = decide(s, req({ signal: "thumbs_down", toggle: false }))
    expect(plan.send).toEqual({ kind: "set", signal: "thumbs_down" })
    expect(plan.selectId).toBe("b")
    expect(plan.undo).toEqual({ artistId: "a", restore: "thumbs_up" })
  })

  it.each(["thumbs_up", "thumbs_down", "skip"] as const)("undo restores the earlier verdict %s", (before) => {
    const s = state({ signals: new Map([["a", before]]) })
    expect(decide(s, req({ signal: before === "skip" ? "thumbs_down" : "skip" })).undo).toEqual({ artistId: "a", restore: before })
  })

  it("an unknown stored value restores to undecided", () => {
    const s = state({ signals: new Map([["a", "weird"]]) })
    expect(decide(s, req({ signal: "skip" })).undo).toEqual({ artistId: "a", restore: undefined })
  })
})

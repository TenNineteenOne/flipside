import { describe, it, expect } from "vitest"
import { counts, firstUndecided, nextUndecided, reconcileSelection, remaining, step, visibleQueue } from "./triage-queue"

const ids = ["a", "b", "c", "d", "e"]
const sig = (entries: Record<string, string>) => new Map(Object.entries(entries))
const none = sig({})

describe("visibleQueue", () => {
  it("keeps undecided and liked artists in original order", () => {
    expect(visibleQueue(ids, sig({ b: "thumbs_up" }))).toEqual(["a", "b", "c", "d", "e"])
  })

  it("drops passed and dismissed artists", () => {
    expect(visibleQueue(ids, sig({ a: "thumbs_down", c: "skip", d: "thumbs_up" }))).toEqual(["b", "d", "e"])
  })

  it("treats unknown signal values as undecided", () => {
    expect(visibleQueue(ids, sig({ a: "something_else" }))).toEqual(ids)
  })

  it("handles an empty list", () => {
    expect(visibleQueue([], none)).toEqual([])
  })
})

describe("remaining", () => {
  it("counts only undecided artists", () => {
    expect(remaining(ids, sig({ a: "thumbs_up", b: "thumbs_down", c: "skip", d: "other" }))).toBe(2)
  })

  it("is 0 for an empty list and when all are decided", () => {
    expect(remaining([], none)).toBe(0)
    expect(remaining(["a", "b"], sig({ a: "thumbs_up", b: "skip" }))).toBe(0)
  })
})

describe("counts", () => {
  it("counts each verdict, ignoring signals for artists not in the list", () => {
    expect(counts(ids, sig({ a: "thumbs_up", b: "thumbs_up", c: "thumbs_down", d: "skip", zz: "thumbs_up" }))).toEqual({
      liked: 2,
      passed: 1,
      dismissed: 1,
    })
  })

  it("is all zero for an empty list", () => {
    expect(counts([], none)).toEqual({ liked: 0, passed: 0, dismissed: 0 })
  })
})

describe("firstUndecided", () => {
  it("returns the first undecided artist in order", () => {
    expect(firstUndecided(ids, sig({ a: "thumbs_up", b: "skip" }))).toBe("c")
  })

  it("is null for an empty list or when all are decided", () => {
    expect(firstUndecided([], none)).toBeNull()
    expect(firstUndecided(["a"], sig({ a: "thumbs_down" }))).toBeNull()
  })
})

describe("nextUndecided", () => {
  it("returns the next undecided artist after fromId", () => {
    expect(nextUndecided(ids, sig({ b: "thumbs_up", c: "thumbs_up" }), "b")).toBe("d")
  })

  it("wraps around to the start", () => {
    expect(nextUndecided(ids, sig({ d: "skip", e: "thumbs_down" }), "d")).toBe("a")
  })

  it("never returns fromId itself", () => {
    expect(nextUndecided(["a", "b"], sig({ b: "thumbs_up" }), "a")).toBeNull()
  })

  it("is null when none are left", () => {
    expect(nextUndecided(["a", "b"], sig({ a: "thumbs_up", b: "skip" }), "a")).toBeNull()
  })

  it("is null for an empty list", () => {
    expect(nextUndecided([], none, "a")).toBeNull()
  })

  it("falls back to the first undecided artist when fromId is unknown", () => {
    expect(nextUndecided(ids, sig({ a: "thumbs_up" }), "zz")).toBe("b")
    expect(nextUndecided(["a", "b"], sig({ a: "skip" }), "zz")).toBe("b")
  })
})

describe("step", () => {
  it("moves to the neighbour in the visible queue, skipping passed and dismissed", () => {
    const s = sig({ b: "thumbs_down", c: "thumbs_up" })
    expect(step(ids, s, "a", 1)).toBe("c")
    expect(step(ids, s, "c", -1)).toBe("a")
  })

  it("clamps at both ends", () => {
    expect(step(ids, none, "e", 1)).toBe("e")
    expect(step(ids, none, "a", -1)).toBe("a")
  })

  it("selects the first visible artist for an unknown or null selected id", () => {
    const s = sig({ a: "skip" })
    expect(step(ids, s, "zz", 1)).toBe("b")
    expect(step(ids, s, null, -1)).toBe("b")
  })

  it("from a decided selection (Snap, tablet), moves to the nearest visible neighbour in feed order", () => {
    // middle
    const mid = sig({ c: "thumbs_down", b: "skip" })
    expect(step(ids, mid, "c", 1)).toBe("d")
    expect(step(ids, mid, "c", -1)).toBe("a")
    // start
    const start = sig({ a: "skip" })
    expect(step(ids, start, "a", 1)).toBe("b")
    expect(step(ids, start, "a", -1)).toBe("a") // nothing before: stays
    // end
    const end = sig({ e: "thumbs_down" })
    expect(step(ids, end, "e", -1)).toBe("d")
    expect(step(ids, end, "e", 1)).toBe("e") // nothing after: stays
  })

  it("is null when the visible queue is empty", () => {
    expect(step([], none, null, 1)).toBeNull()
    expect(step(["a"], sig({ a: "skip" }), "a", 1)).toBeNull()
  })
})

describe("reconcileSelection", () => {
  const none = new Map<string, string>()
  it("keeps a loaded selection when artists are appended", () => {
    expect(reconcileSelection(["a", "b", "c", "d"], none, "b")).toBe("b")
  })
  it("keeps a decided-but-loaded selection (e.g. a liked artist clicked again)", () => {
    expect(reconcileSelection(["a", "b"], new Map([["a", "thumbs_up"]]), "a")).toBe("a")
  })
  it("end of queue: stays null until an undecided artist arrives, then selects it", () => {
    const decided = new Map([["a", "thumbs_up"], ["b", "skip"]])
    expect(reconcileSelection(["a", "b"], decided, null)).toBeNull()
    expect(reconcileSelection(["a", "b", "c", "d"], decided, null)).toBe("c")
  })
  it("a selected id no longer in the list falls back to the first undecided", () => {
    expect(reconcileSelection(["a", "b"], new Map([["a", "thumbs_down"]]), "gone")).toBe("b")
  })
})

import { describe, expect, it } from "vitest"
import { mergeLeaving, type Shown } from "./use-leaving"

const id = (s: string) => s
const show = (keys: string, leaving = ""): Shown<string>[] =>
  keys.split("").map((k) => ({ item: k, key: k, leaving: leaving.includes(k) }))
const view = (s: Shown<string>[]) => s.map((x) => (x.leaving ? x.key.toUpperCase() : x.key)).join("")

describe("mergeLeaving", () => {
  it("keeps a removed item in place, marked leaving", () => {
    expect(view(mergeLeaving(show("abcd"), ["a", "c", "d"], id, true))).toBe("aBcd")
    expect(view(mergeLeaving(show("abcd"), ["b", "c", "d"], id, true))).toBe("Abcd")
    expect(view(mergeLeaving(show("abcd"), ["a", "b", "c"], id, true))).toBe("abcD")
  })

  it("drops removed items at once without animation, and leaving ones once done", () => {
    expect(view(mergeLeaving(show("abcd"), ["a", "c", "d"], id, false))).toBe("acd")
    expect(view(mergeLeaving(show("abcd", "b"), ["a", "c"], id, true))).toBe("aBcD")
  })

  it("places appended and re-inserted items by the new order", () => {
    expect(view(mergeLeaving(show("ac"), ["a", "c", "d", "e"], id, true))).toBe("acde")
    // undo re-inserts b between a and c
    expect(view(mergeLeaving(show("ac"), ["a", "b", "c"], id, true))).toBe("abc")
    // undo while b is still leaving: it comes back in place
    expect(view(mergeLeaving(show("abc", "b"), ["a", "b", "c"], id, true))).toBe("abc")
    expect(view(mergeLeaving(show("bc"), ["a", "b", "c"], id, true))).toBe("abc")
  })

  it("takes the fresh item objects for retained keys", () => {
    const shown = [{ item: { k: "a", v: 1 }, key: "a", leaving: false }]
    const fresh = { k: "a", v: 2 }
    expect(mergeLeaving(shown, [fresh], (t) => t.k, true)[0].item).toBe(fresh)
  })
})

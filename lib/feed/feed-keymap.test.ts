import { describe, it, expect } from "vitest"
import { feedAction } from "./feed-keymap"

const press = (key: string, ctx: Partial<Parameters<typeof feedAction>[0]> = {}) =>
  feedAction({
    key,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    targetIsEditable: false,
    targetIsButtonOrLink: false,
    helpOpen: false,
    ...ctx,
  })

describe("feedAction", () => {
  it.each([
    ["j", "next"],
    ["ArrowDown", "next"],
    ["k", "prev"],
    ["ArrowUp", "prev"],
    [" ", "togglePlay"],
    ["1", "track1"],
    ["2", "track2"],
    ["3", "track3"],
    ["l", "more"],
    ["x", "less"],
    ["d", "dismiss"],
    ["b", "save"],
    ["o", "open"],
    ["s", "share"],
    ["z", "undo"],
    ["?", "toggleHelp"],
  ])("maps %j to %s", (key, action) => {
    expect(press(key)).toBe(action)
  })

  it("maps Shift+/ to toggleHelp", () => {
    expect(press("/", { shiftKey: true })).toBe("toggleHelp")
    expect(press("/")).toBeNull()
  })

  it("ignores case (caps lock / shift)", () => {
    expect(press("J", { shiftKey: true })).toBe("next")
    expect(press("L")).toBe("more")
  })

  it("returns null for unbound keys", () => {
    expect(press("q")).toBeNull()
    expect(press("4")).toBeNull()
    expect(press("Enter")).toBeNull()
  })

  it.each(["metaKey", "ctrlKey", "altKey"] as const)("returns null when %s is held", (mod) => {
    expect(press("j", { [mod]: true })).toBeNull()
    expect(press("?", { [mod]: true })).toBeNull()
  })

  it("returns null when the target is editable, including help", () => {
    expect(press("j", { targetIsEditable: true })).toBeNull()
    expect(press(" ", { targetIsEditable: true })).toBeNull()
    expect(press("?", { targetIsEditable: true })).toBeNull()
  })

  it("lets Space press a focused button or link instead of toggling play", () => {
    expect(press(" ", { targetIsButtonOrLink: true })).toBeNull()
    // other keys still work on a focused control
    expect(press("l", { targetIsButtonOrLink: true })).toBe("more")
  })

  it("suppresses everything but toggleHelp while help is open", () => {
    expect(press("j", { helpOpen: true })).toBeNull()
    expect(press("z", { helpOpen: true })).toBeNull()
    expect(press(" ", { helpOpen: true })).toBeNull()
    expect(press("?", { helpOpen: true })).toBe("toggleHelp")
  })
})

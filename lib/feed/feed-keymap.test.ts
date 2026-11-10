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
    repeat: false,
    ...ctx,
  })

describe("feedAction", () => {
  it("ignores keys inside an open menu, dialog or popup, and keys already handled (defaultPrevented)", () => {
    for (const k of ["ArrowDown", "x", "j", " ", "?"]) {
      expect(press(k, { targetInPopup: true })).toBeNull()
      expect(press(k, { defaultPrevented: true })).toBeNull()
    }
    expect(press("x", { targetInPopup: false, defaultPrevented: false })).toBe("less")
  })

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

describe("feedAction: key repeat", () => {
  it.each(["x", "l", "d", "o", " ", "b", "s", "z", "1", "?"])("ignores an auto-repeat of %j", (key) => {
    expect(press(key, { repeat: true })).toBeNull()
  })
  it.each([["j", "next"], ["k", "prev"], ["ArrowDown", "next"], ["ArrowUp", "prev"]])("repeats %s (movement)", (key, action) => {
    expect(press(key, { repeat: true })).toBe(action)
  })
})

describe("feedAction: non-Latin layouts fall back to the physical key", () => {
  it.each([
    ["о", "KeyJ", "next"], ["л", "KeyK", "prev"], ["д", "KeyL", "more"], ["ч", "KeyX", "less"],
    ["в", "KeyD", "dismiss"], ["и", "KeyB", "save"], ["щ", "KeyO", "open"], ["ы", "KeyS", "share"],
    ["я", "KeyZ", "undo"], ["&", "Digit1", "track1"], ["é", "Digit2", "track2"], ["\"", "Digit3", "track3"],
    ["End", "Numpad1", "track1"], ["ArrowDown", "Numpad2", "next"], ["ς", "KeyJ", "next"],
  ])("%j on %s → %s", (key, code, action) => {
    expect(press(key, { code })).toBe(action)
  })
  it("a bound key wins over its code (Dvorak 'x' is on KeyB)", () => {
    expect(press("x", { code: "KeyB" })).toBe("less")
  })
  it("an unbound Latin letter does not borrow its code (Dvorak 'q' is on KeyX)", () => {
    expect(press("q", { code: "KeyX" })).toBeNull()
  })
  it("? stays key-based", () => {
    expect(press(",", { code: "Slash", shiftKey: true })).toBeNull()
  })
  it("modifiers, editable targets and help still block the fallback", () => {
    expect(press("ч", { code: "KeyX", ctrlKey: true })).toBeNull()
    expect(press("ч", { code: "KeyX", targetIsEditable: true })).toBeNull()
    expect(press("ч", { code: "KeyX", helpOpen: true })).toBeNull()
  })
})

/** Pure key-to-action map for the Evolved feed (PRD #182, Modules 2). */

export type FeedAction =
  | "next" | "prev" | "togglePlay" | "track1" | "track2" | "track3"
  | "more" | "less" | "dismiss" | "save" | "open" | "share" | "undo" | "toggleHelp"

const BINDINGS: Record<string, FeedAction> = {
  j: "next",
  arrowdown: "next",
  k: "prev",
  arrowup: "prev",
  " ": "togglePlay",
  "1": "track1",
  "2": "track2",
  "3": "track3",
  l: "more",
  x: "less",
  d: "dismiss",
  b: "save",
  o: "open",
  s: "share",
  z: "undo",
}

/** Physical keys (KeyboardEvent.code) for layouts whose letters are not Latin (Russian, Greek…). */
const CODES: Record<string, FeedAction> = {
  KeyJ: "next", KeyK: "prev", ArrowDown: "next", ArrowUp: "prev", Space: "togglePlay",
  Digit1: "track1", Digit2: "track2", Digit3: "track3", Numpad1: "track1", Numpad2: "track2", Numpad3: "track3",
  KeyL: "more", KeyX: "less", KeyD: "dismiss", KeyB: "save", KeyO: "open", KeyS: "share", KeyZ: "undo",
}

export function feedAction(e: {
  key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean
  targetIsEditable: boolean      // input, textarea, select, contenteditable
  targetIsButtonOrLink: boolean  // Space must not double-fire on a focused control
  helpOpen: boolean
  repeat: boolean                // held-key auto-repeat: only movement repeats
  code?: string                  // physical key, used when `key` is not bound
}): FeedAction | null {
  const action = keyAction(e)
  return e.repeat && action !== "next" && action !== "prev" ? null : action
}

function keyAction(e: Parameters<typeof feedAction>[0]): FeedAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.targetIsEditable) return null
  if (e.key === "?" || (e.key === "/" && e.shiftKey)) return "toggleHelp"
  if (e.helpOpen) return null
  // Lower-case so caps lock / Shift still match. An unbound Latin letter is a
  // deliberate key on another Latin layout (Dvorak "q" sits on KeyX), so only
  // other characters fall back to the physical key.
  const bound = BINDINGS[e.key.toLowerCase()]
  const action = bound ?? (/^[a-z]$/i.test(e.key) ? undefined : CODES[e.code ?? ""]) ?? null
  if (action === "togglePlay" && e.targetIsButtonOrLink) return null
  return action
}

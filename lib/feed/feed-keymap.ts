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

export function feedAction(e: {
  key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean
  targetIsEditable: boolean      // input, textarea, select, contenteditable
  targetIsButtonOrLink: boolean  // Space must not double-fire on a focused control
  helpOpen: boolean
}): FeedAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.targetIsEditable) return null
  if (e.key === "?" || (e.key === "/" && e.shiftKey)) return "toggleHelp"
  if (e.helpOpen) return null
  if (e.key === " " && e.targetIsButtonOrLink) return null
  // Lower-case so caps lock / Shift still match.
  return BINDINGS[e.key.toLowerCase()] ?? null
}

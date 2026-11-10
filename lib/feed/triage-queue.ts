/**
 * Pure "what next" logic for the Evolved feed (PRD #182, Modules 1).
 * Verdicts are always derived from the artist-feedback hook's signals map:
 * thumbs_up = liked (stays in the queue), thumbs_down = passed and
 * skip = dismissed (both leave it); any other or missing value = undecided.
 */

export type Signal = "thumbs_up" | "thumbs_down" | "skip"
export type Signals = ReadonlyMap<string, string>

const isDecided = (signals: Signals, id: string) => {
  const s = signals.get(id)
  return s === "thumbs_up" || s === "thumbs_down" || s === "skip"
}

/** Artists still shown in the desktop queue: undecided + liked, in original order. */
export function visibleQueue(ids: readonly string[], signals: Signals): string[] {
  return ids.filter((id) => {
    const s = signals.get(id)
    return s !== "thumbs_down" && s !== "skip"
  })
}

/** Count of undecided artists. */
export function remaining(ids: readonly string[], signals: Signals): number {
  return ids.filter((id) => !isDecided(signals, id)).length
}

/** { liked, passed, dismissed } */
export function counts(ids: readonly string[], signals: Signals): { liked: number; passed: number; dismissed: number } {
  const c = { liked: 0, passed: 0, dismissed: 0 }
  for (const id of ids) {
    const s = signals.get(id)
    if (s === "thumbs_up") c.liked++
    else if (s === "thumbs_down") c.passed++
    else if (s === "skip") c.dismissed++
  }
  return c
}

/** First undecided artist, or null. Used for the initial selection. */
export function firstUndecided(ids: readonly string[], signals: Signals): string | null {
  return ids.find((id) => !isDecided(signals, id)) ?? null
}

/**
 * Next undecided artist after `fromId`, wrapping once; null when none are left.
 * Pass the signals as they will be after the decision, so the judged artist is
 * never returned. An unknown `fromId` falls back to `firstUndecided`.
 */
export function nextUndecided(ids: readonly string[], signals: Signals, fromId: string): string | null {
  const i = ids.indexOf(fromId)
  if (i < 0) return firstUndecided(ids, signals)
  for (let k = 1; k < ids.length; k++) {
    const id = ids[(i + k) % ids.length]
    if (!isDecided(signals, id)) return id
  }
  return null
}

/**
 * Neighbour in the visible queue for keyboard movement; clamps at both ends.
 * A selected id that is unknown, null or no longer visible selects the first visible artist.
 */
export function step(ids: readonly string[], signals: Signals, selectedId: string | null, dir: 1 | -1): string | null {
  const visible = visibleQueue(ids, signals)
  if (visible.length === 0) return null
  const i = selectedId === null ? -1 : visible.indexOf(selectedId)
  if (i < 0) return visible[0]
  return visible[Math.min(visible.length - 1, Math.max(0, i + dir))]
}

/**
 * The selection to show after the list or signals change: the selected id while
 * it is still loaded; otherwise (null = end of queue, or an id no longer in the
 * list) the first undecided artist, so artists appended after the end of the
 * queue get selected and appends never move an existing selection.
 */
export function reconcileSelection(ids: readonly string[], signals: Signals, selectedId: string | null): string | null {
  return selectedId !== null && ids.includes(selectedId) ? selectedId : firstUndecided(ids, signals)
}

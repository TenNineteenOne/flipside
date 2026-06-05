/**
 * Total candidate window. Must match the legacy PRIMARY(60)+SECONDARY(30)
 * behavior so no recommendations are dropped — only the blocking/background
 * boundary moves. Tuning changes `BLOCKING_RESOLVE_CAP`, never this.
 */
export const RESOLVE_WINDOW = 90

/**
 * Blocking resolve cap (Approach A). Set by measurement in a later task: the
 * largest value that still lands the cold generation inside 3–5s. Default 36.
 * Secondary is whatever remains of RESOLVE_WINDOW after the blocking slice.
 */
export const BLOCKING_RESOLVE_CAP = 36
export const SECONDARY_RESOLVE_CAP = RESOLVE_WINDOW - BLOCKING_RESOLVE_CAP

export interface ResolvePools {
  /** Resolved synchronously before the feed is written (paints visible cards). */
  blocking: string[]
  /** Resolved in the background `after()` tail; appended to the queue. */
  secondary: string[]
}

/** Split a round-robin-ordered name list into blocking + secondary slices. */
export function splitResolvePools(allNames: string[]): ResolvePools {
  return {
    blocking: allNames.slice(0, BLOCKING_RESOLVE_CAP),
    secondary: allNames.slice(BLOCKING_RESOLVE_CAP, BLOCKING_RESOLVE_CAP + SECONDARY_RESOLVE_CAP),
  }
}

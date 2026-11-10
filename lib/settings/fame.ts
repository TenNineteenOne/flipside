/**
 * "How famous?" — the one Settings control for popularity (#205). Stored as
 * `users.fame_level` (0–4, default 2); this is the only place it maps to the
 * engine's inputs.
 */

export const FAME_LEVELS = ["Underground only", "Mostly niche", "Balanced", "Mostly popular", "Anything goes"] as const
export const DEFAULT_FAME_LEVEL = 2
export const MAX_FAME_LEVEL = FAME_LEVELS.length - 1

const CURVES = [0.9, 0.92, 0.95, 0.97, 0.99] as const

/** True for an integer stop 0–4 (the PATCH /api/settings validator). */
export function isFameLevel(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_FAME_LEVEL
}

/**
 * Engine inputs for a fame level: the `k` of `k^popularity` scoring, and the
 * hard popularity <= 50 cap (stop 0 only). Anything invalid (null on a
 * pre-migration row) reads as the default.
 */
export function fameToEngine(level: unknown): { popularityCurve: number; undergroundMode: boolean } {
  const l = isFameLevel(level) ? level : DEFAULT_FAME_LEVEL
  return { popularityCurve: CURVES[l], undergroundMode: l === 0 }
}

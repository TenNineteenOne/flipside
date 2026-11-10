/**
 * Double-activation guard for feed decisions: a triage control re-binds to the
 * next artist as soon as one is decided, so a double tap/click (or two quick
 * key presses) would decide a second, unseen artist. An advancing decision on a
 * different artist within this window of the last advancing one is ignored; a
 * second decision on the same artist (e.g. un-like) still goes through.
 */
export const DOUBLE_ACTIVATION_MS = 350

export function isDoubleActivation(
  last: { artistId: string; at: number } | null,
  artistId: string,
  advance: boolean,
  now: number,
): boolean {
  return advance && last !== null && last.artistId !== artistId && now - last.at < DOUBLE_ACTIVATION_MS
}

/**
 * The guard's stamp after an advancing decision on `artistId`: a new window only when the
 * selection actually moved (`selectedBefore` → `selectedAfter`); a decision that left it in
 * place (an un-like) keeps the previous stamp.
 */
export function activationStamp(
  last: { artistId: string; at: number } | null,
  artistId: string,
  selectedBefore: string | null,
  selectedAfter: string | null,
  now: number,
): { artistId: string; at: number } | null {
  return selectedAfter !== selectedBefore ? { artistId, at: now } : last
}

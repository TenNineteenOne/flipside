/**
 * "Tuning" summary (PRD #182, Modules 6): genres the listener's decisions lean
 * toward (liked artists, up to six) and away from (passed artists, up to four),
 * deduplicated, in first-seen feed order. Dismissed artists count for neither.
 */
export function tuning(
  artists: readonly { id: string; genres: readonly string[] }[],
  signals: ReadonlyMap<string, string>,
): { more: string[]; less: string[] } {
  const more = new Set<string>()
  const less = new Set<string>()
  for (const a of artists) {
    const s = signals.get(a.id)
    const into = s === "thumbs_up" ? more : s === "thumbs_down" ? less : null
    a.genres.forEach((g) => into?.add(g))
  }
  return { more: [...more].slice(0, 6), less: [...less].slice(0, 4) }
}

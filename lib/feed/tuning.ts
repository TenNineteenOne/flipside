/**
 * "Tuning" summary (PRD #182, Modules 6): genres the listener's decisions lean
 * toward (liked artists, up to six) and away from (passed artists, up to four),
 * deduplicated case-insensitively (first-seen casing), in first-seen feed order;
 * a genre both liked and passed counts only as liked. Dismissed artists count for neither.
 */
export function tuning(
  artists: readonly { id: string; genres: readonly string[] }[],
  signals: ReadonlyMap<string, string>,
): { more: string[]; less: string[] } {
  // Keyed by lower case, valued by the first-seen casing.
  const collect = (signal: string) => {
    const out = new Map<string, string>()
    for (const a of artists) if (signals.get(a.id) === signal) for (const g of a.genres) if (!out.has(g.toLowerCase())) out.set(g.toLowerCase(), g)
    return out
  }
  const more = collect("thumbs_up")
  const less = [...collect("thumbs_down")].filter(([k]) => !more.has(k)) // liked wins
  return { more: [...more.values()].slice(0, 6), less: less.map(([, g]) => g).slice(0, 4) }
}

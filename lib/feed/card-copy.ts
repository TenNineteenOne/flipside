/** Card copy helpers for the Evolved feed (PRD #182, Modules 4). */

export interface WhyParts {
  lead: string
  /** Source-artist names; the UI renders these bold, joined with `listSeparator`. */
  names: string[]
  /** Only set when there are no source artists; joined with ", ". */
  genres: string[]
}

/** The "why" sentence as parts, or null when there is nothing to say. */
export function whyParts(why: { sourceArtists: readonly string[]; genres: readonly string[] }): WhyParts | null {
  if (why.sourceArtists.length > 0) return { lead: "Because you like ", names: [...why.sourceArtists], genres: [] }
  if (why.genres.length > 0) return { lead: "Because you like ", names: [], genres: [...why.genres] }
  return null
}

/** Separator to put before item `i` of `n` so the list reads "A, B and C". */
export function listSeparator(i: number, n: number): string {
  if (i === 0) return ""
  return i === n - 1 ? " and " : ", "
}

/** The "why" sentence as plain text (share text, labels), or null. */
export function whyText(why: { sourceArtists: readonly string[]; genres: readonly string[] }): string | null {
  const p = whyParts(why)
  if (!p) return null
  if (p.names.length === 0) return p.lead + p.genres.join(", ")
  return p.lead + p.names.map((n, i) => listSeparator(i, p.names.length) + n).join("")
}

/** Upper bounds (exclusive) for each popularity label; tune against real data here. */
export const POPULARITY_LABELS: readonly { below: number; label: string }[] = [
  { below: 35, label: "Barely charted" },
  { below: 45, label: "Deep cut" },
  { below: 52, label: "Under the radar" },
]

export function popularityLabel(popularity: number): string {
  return POPULARITY_LABELS.find((t) => popularity < t.below)?.label ?? "Cult following"
}

/**
 * Track duration in milliseconds as m:ss (h:mm:ss from an hour). Empty when
 * there is no real duration (iTunes tracks without one are stored as 0).
 */
export function formatDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return ""
  const s = Math.round(ms / 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  const h = Math.floor(s / 3600)
  const m = Math.floor(s / 60) % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

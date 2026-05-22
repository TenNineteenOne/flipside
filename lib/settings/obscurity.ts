// Obscurity model: threshold maps directly to the mock's four-stop ladder.
// Low threshold = strict niche cap = "Deep underground". High threshold = loose
// familiarity cap = "Familiar". Same copy as before; labels refreshed to the
// design's crisper framing. DB column stays `play_threshold`.

export const MINT = "#7dd9c6"
export const BLUE = "#a8c7fa"
export const ACCENT = "#8b5cf6"
export const AMBER = "#f5b047"
export const ROSE = "#ec6fb5"
export const LASTFM_RED = "#d7002a"
export const STATSFM_PURPLE = "#8b5cf6"

export function obscurityLabel(t: number): string {
  if (t < 5) return "Deep underground"
  if (t < 15) return "Offbeat"
  if (t < 30) return "Curious"
  return "Familiar"
}

export function obscurityHelp(t: number): string {
  if (t < 5) return "Almost nothing you’ve heard before will appear."
  if (t < 15) return "Mostly unfamiliar names with the occasional half-known artist."
  if (t < 30) return "A balanced mix — some discovery, some comfort."
  return "Includes artists you already play often."
}

export function obscurityColor(t: number): string {
  if (t < 5) return MINT
  if (t < 15) return BLUE
  if (t < 30) return ACCENT
  return AMBER
}

// Server-only: reduces data/genres.json (3.1 MB) to what the map draws. Never import from a client component.
import raw from "@/data/genres.json"
import type { GenreNode } from "@/lib/types"
import { labArtists } from "@/lib/lab/artists"
import { REGION, gridRef, type AtlasGenres, type AtlasPin, type AtlasSetup, type Place } from "./types"

// everynoise is a tall strip (x 0..1500, y 0..22648). Lay it on its side and stretch the short axis
// so it reads as a landscape map: west = electric, east = acoustic, north = atmospheric, south = bouncy.
const PAD = 600
const STRETCH = 5
const toWorld = (n: GenreNode) => ({ x: Math.round(n.y! + PAD), y: Math.round(n.x! * STRETCH + PAD) })

interface Leaf { label: string; x: number; y: number; color: string; f: number; a: number; cluster: string; ex: string }

const leaves: Leaf[] = []
const anchorNames: string[] = []
;(raw as { nodes: GenreNode[] }).nodes.forEach((anchor, ai) => {
  anchorNames.push(anchor.label)
  const walk = (n: GenreNode, cluster: string) => {
    if (n.children?.length) return n.children.forEach((c) => walk(c, cluster || (n === anchor ? "" : n.label)))
    leaves.push({ label: n.label, ...toWorld(n), color: (n.color ?? "#777777").slice(1), f: (n.fontSize ?? 100) - 100, a: ai, cluster, ex: n.exemplar ?? "" })
  }
  anchor.children.forEach((c) => walk(c, c.children?.length ? c.label : ""))
})
leaves.sort((p, q) => q.f - p.f)

const W = 22648 + PAD * 2
const H = 1500 * STRETCH + PAD * 2
const byLabel = new Map(leaves.map((l) => [l.label, l]))
const at = (label: string): Place => {
  const l = byLabel.get(label)
  if (!l) throw new Error(`atlas: no genre "${label}" in genres.json`)
  return { label, x: l.x, y: l.y }
}

/** Label sits at the densest bin of its members, so scattered groups don't all pile up mid-map. */
function densest(members: Leaf[], bin: number) {
  const counts = new Map<string, Leaf[]>()
  for (const m of members) {
    const k = `${Math.floor(m.x / bin)},${Math.floor(m.y / bin)}`
    counts.set(k, [...(counts.get(k) ?? []), m])
  }
  const best = [...counts.values()].sort((p, q) => q.length - p.length)[0]
  return { x: Math.round(best.reduce((s, m) => s + m.x, 0) / best.length), y: Math.round(best.reduce((s, m) => s + m.y, 0) / best.length), n: best.length }
}

let genresCache: AtlasGenres | null = null
export function atlasGenres(): AtlasGenres {
  if (genresCache) return genresCache
  const regions: AtlasGenres["regions"] = anchorNames.map((label, i) => ({ label, ...pick(densest(leaves.filter((l) => l.a === i), 2600)), kind: 0 as const }))
  const clusters = new Map<string, Leaf[]>()
  for (const l of leaves) if (l.cluster && !/^More /.test(l.cluster)) clusters.set(l.cluster, [...(clusters.get(l.cluster) ?? []), l])
  for (const [label, members] of clusters) if (members.length >= 6) regions.push({ label, ...pick(densest(members, 1300)), kind: 1 })
  genresCache = {
    w: W,
    h: H,
    labels: leaves.map((l) => l.label).join("|"),
    ex: leaves.map((l) => l.ex.replace(/\|/g, "/")).join("|"),
    xy: leaves.flatMap((l) => [l.x, l.y]),
    c: leaves.map((l) => l.color).join(""),
    f: leaves.map((l) => l.f),
    a: leaves.map((l) => l.a.toString(16)).join(""),
    regions,
  }
  return genresCache
}
const pick = ({ x, y }: { x: number; y: number }) => ({ x, y })

// ── Your territory and the pins ───────────────────────────────────────────────

/** The listener's home turf: where their own taste already lives. */
const HOME = ["psychedelic soul", "neo-psychedelic", "psychedelic blues-rock", "australian psych", "indie pop", "dream pop", "art pop", "bedroom soul", "deep surf music", "psychedelic rock", "funk", "indie rock"]

/** Where each "similar to" artist lives. Hand-placed: these are the landmarks the directions are given from. */
const SOURCE_GENRE: Record<string, string> = {
  Khruangbin: "psychedelic soul", "Tame Impala": "neo-psychedelic", "Jimi Hendrix": "psychedelic blues-rock", "King Gizzard": "australian psych",
  Parcels: "indie pop", "Men I Trust": "dream pop", Stereolab: "art pop", "Tom Misch": "bedroom soul", "La Luz": "deep surf music",
  "Altın Gün": "turkish psych", "Ry Cooder": "classic rock", Tinariwen: "desert blues", BADBADNOTGOOD: "instrumental hip hop",
  "Floating Points": "electronica", "Alice Coltrane": "avant-garde jazz", "Nick Drake": "folk rock", "Joanna Newsom": "freak folk",
  "Four Tet": "indie electronica", Caribou: "indie electronica", "Ezra Collective": "nu jazz", "Fela Kuti": "classic afrobeat",
  "Caetano Veloso": "tropicalia", "Devendra Banhart": "freak folk", Can: "krautrock", "King Tubby": "reggae", "Kamaal Williams": "nu jazz",
}

/** Freeform artist genre strings that have no exact leaf, mapped by hand. */
const ALIAS: Record<string, string> = {
  "thai funk": "thai psychedelic", "anatolian rock": "turkish psych", "latin western": "western americana", "tuareg rock": "tuareg guitar",
  "neo-sufi": "sufi", "uk jazz": "uk contemporary jazz", "psych pop": "indie psych-pop", "japanese psych": "krautrock",
}

/** Exact match, then the alias table, then best token overlap, so every artist lands somewhere sensible. */
export function placeGenre(genres: string[]): string {
  for (const g of genres) {
    if (byLabel.has(g)) return g
    if (ALIAS[g]) return ALIAS[g]
  }
  const tokens = new Set(genres.flatMap((g) => g.split(/[\s-]+/)))
  let best = "", score = 0
  for (const l of leaves) {
    const words = l.label.split(/[\s-]+/)
    const s = words.filter((w) => tokens.has(w)).length / words.length
    if (s > score) [best, score] = [l.label, s]
  }
  return score > 0 ? best : "funk"
}

const DIRS = ["east", "northeast", "north", "northwest", "west", "southwest", "south", "southeast"]
const LEANS: Record<string, string> = {
  east: "more acoustic", west: "more electric", north: "more atmospheric", south: "bouncier",
  northeast: "acoustic and spacious", northwest: "electric and spacious", southeast: "acoustic and bouncy", southwest: "electric and bouncy",
}
const compass = (dx: number, dy: number) => DIRS[((Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) % 8) + 8) % 8]

let setupCache: AtlasSetup | null = null
export function atlasSetup(): AtlasSetup {
  if (setupCache) return setupCache
  const home = HOME.map(at)
  const centre = { x: Math.round(home.reduce((s, p) => s + p.x, 0) / home.length), y: Math.round(home.reduce((s, p) => s + p.y, 0) / home.length) }
  const coast = leaves.filter((l) => home.some((h) => Math.hypot(h.x - l.x, h.y - l.y) < 420)).flatMap((l) => [l.x, l.y])
  const sources = Object.entries(SOURCE_GENRE).map(([name, g]) => ({ ...at(g), label: name }))
  const used = new Map<string, number>()
  const pins: AtlasPin[] = labArtists.map((artist) => {
    const genre = placeGenre(artist.genres)
    const p = at(genre)
    // Two pins on one genre fan out instead of stacking.
    const n = used.get(genre) ?? 0
    used.set(genre, n + 1)
    const x = p.x + n * 160, y = p.y + n * 120
    const name = artist.why.sourceArtists[0]
    const src = sources.find((s) => s.label === name)
    if (!src) throw new Error(`atlas: no landmark for source artist "${name}"`)
    const dx = x - src.x, dy = y - src.y
    const d = Math.hypot(dx, dy) / REGION
    const dir = compass(dx, dy)
    const regions = Math.max(1, Math.round(d))
    return {
      artistId: artist.id, genre, x, y, grid: gridRef(x, y),
      reach: Math.round((Math.hypot(x - centre.x, y - centre.y) / REGION) * 10) / 10,
      source: name,
      directions: d < 0.6 ? `Next door to ${name}` : `${regions} region${regions > 1 ? "s" : ""} ${dir} of ${name}`,
      heading: `${dir}: ${LEANS[dir]}`,
    }
  })
  setupCache = { w: W, h: H, home, sources, coast, centre, pins }
  return setupCache
}

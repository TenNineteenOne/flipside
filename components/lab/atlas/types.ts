// Shapes shared by the server-side reduction (data.server.ts) and the client map.

/** Columnar, compact view of all ~6.3k leaf genres, sorted by prominence (fontSize desc). */
export interface AtlasGenres {
  w: number
  h: number
  /** Leaf labels joined with "|". */
  labels: string
  /** Exemplar artist per leaf joined with "|". */
  ex: string
  /** Flat [x0, y0, x1, y1, …] world coordinates (ints). */
  xy: number[]
  /** Concatenated 6-char hex colours, one per leaf. */
  c: string
  /** fontSize - 100 (0..60): the data's own prominence score. */
  f: number[]
  /** Anchor index per leaf, as one char each ("0".."b"). */
  a: string
  /** Region labels: anchors (kind 0) and clusters (kind 1), placed at their densest spot. */
  regions: { label: string; x: number; y: number; kind: 0 | 1 }[]
}

export interface Place {
  label: string
  x: number
  y: number
}

export interface AtlasPin {
  artistId: string
  genre: string
  x: number
  y: number
  grid: string
  /** Distance from the centre of your territory, in regions (1 region = 1000 world units). */
  reach: number
  source: string
  /** "2 regions east of Khruangbin" */
  directions: string
  /** "east: more acoustic" */
  heading: string
}

export interface AtlasSetup {
  w: number
  h: number
  home: Place[]
  sources: Place[]
  /** Leaf positions that make up the coastline of your territory, flat [x, y, …]. */
  coast: number[]
  centre: { x: number; y: number }
  pins: AtlasPin[]
}

export const REGION = 1000
export const GRID = 1000
export const gridRef = (x: number, y: number) => String.fromCharCode(65 + Math.floor(x / GRID)) + (1 + Math.floor(y / GRID))

export interface GenreNode {
  id: string          // e.g. "sp:indie-rock" (leaf) or "ANCHOR_rock" / "CLUSTER_rock_indie" (internal)
  label: string       // human-readable e.g. "indie rock"
  lastfmTag: string   // Last.fm tag string e.g. "indie-rock"
  parentId: string | null
  children: GenreNode[]
  // Leaves only: 2D everynoise.com sonic-map coordinates.
  x?: number
  y?: number
  color?: string
  fontSize?: number
  exemplar?: string
}

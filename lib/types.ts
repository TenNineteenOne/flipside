export interface GenreNode {
  id: string          // Wikidata QID e.g. "Q11399"
  label: string       // human-readable e.g. "Jazz"
  lastfmTag: string   // Last.fm tag string e.g. "jazz"
  parentId: string | null
  children: GenreNode[]
}

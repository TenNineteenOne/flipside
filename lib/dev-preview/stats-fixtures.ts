// Dev-preview only. Production code must never import from lib/dev-preview.
import type { StatsData } from "@/app/(app)/stats/stats-data"
import labArtists from "./lab-artists.json"

/**
 * Stats fixtures in the exact shape loadStats returns (app/(app)/stats/page.tsx passes it through).
 * Edge cases in `full`: the second lab artist is both saved and liked (the taste profile shows it once, as
 * saved), one artist has popularity 0 (loadStats' fallback for a missing value), one has 100.
 */
const fullSaved = labArtists.slice(0, 6).map((a) => ({ name: a.name, popularity: a.popularity }))
const fullLiked = [
  ...labArtists.slice(6).map((a) => ({ name: a.name, popularity: a.popularity })),
  { name: labArtists[1].name, popularity: labArtists[1].popularity },
  { name: "Unknown Tapes", popularity: 0 },
  { name: "Arena Headliner", popularity: 100 },
]

export const statsFull: StatsData = {
  totalDiscovered: 248,
  totalSaves: 31,
  totalLikes: 57,
  totalDislikes: 42,
  topGenres: [
    { genre: "psychedelic rock", count: 14 },
    { genre: "anatolian rock", count: 9 },
    { genre: "desert blues", count: 7 },
    { genre: "thai funk", count: 5 },
    { genre: "dub", count: 2 },
  ],
  savedArtists: fullSaved,
  likedArtists: fullLiked,
}

/** A new account: a few artists seen in the feed, nothing decided yet. */
export const statsEmpty: StatsData = {
  totalDiscovered: 6,
  totalSaves: 0,
  totalLikes: 0,
  totalDislikes: 0,
  topGenres: [],
  savedArtists: [],
  likedArtists: [],
}

const longName = (i: number) =>
  i % 7 === 0 ? `The Extraordinarily Long-Named Collective of Northern Electric Orchestra Number ${i}` : `Artist ${i}`

/** Long genre names, very large counts and many scatter points (200, clustered and spread). */
export const statsStress: StatsData = {
  totalDiscovered: 1234567,
  totalSaves: 98765,
  totalLikes: 456789,
  totalDislikes: 333333,
  topGenres: [
    { genre: "progressive psychedelic anatolian space rock revival", count: 123456 },
    { genre: "lo-fi bedroom pop with field recordings", count: 98765 },
    { genre: "supercalifragilisticexpialidociouscorecore", count: 5432 },
    { genre: "música popular brasileira", count: 321 },
    { genre: "k-indie", count: 1 },
  ],
  savedArtists: Array.from({ length: 80 }, (_, i) => ({ name: longName(i), popularity: (i * 37) % 101 })),
  likedArtists: Array.from({ length: 120 }, (_, i) => ({ name: `Liked ${longName(i + 80)}`, popularity: 20 + ((i * 13) % 30) })),
}

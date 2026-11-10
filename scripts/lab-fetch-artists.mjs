// Design-lab only: builds lib/lab/artists.json from the public iTunes Search API
// (real artwork + 30s previews) so prototypes play real audio without auth or DB.
import { Vibrant } from "node-vibrant/node"
import { writeFileSync } from "node:fs"

const picks = [
  ["YĪN YĪN", ["psychedelic funk", "thai funk"], ["Khruangbin", "Altın Gün"], 34],
  ["Altın Gün", ["anatolian rock", "psych folk"], ["Khruangbin"], 48],
  ["Hermanos Gutiérrez", ["instrumental", "latin western"], ["Khruangbin", "Ry Cooder"], 55],
  ["Mdou Moctar", ["tuareg rock", "desert blues"], ["Tinariwen", "Jimi Hendrix"], 44],
  ["Glass Beams", ["psych rock", "indian fusion"], ["Khruangbin"], 46],
  ["Surprise Chef", ["cinematic soul", "jazz funk"], ["BADBADNOTGOOD"], 38],
  ["Nala Sinephro", ["ambient jazz", "spiritual jazz"], ["Floating Points", "Alice Coltrane"], 41],
  ["Arooj Aftab", ["neo-sufi", "chamber folk"], ["Nick Drake"], 43],
  ["Los Bitchos", ["cumbia", "instrumental surf"], ["Khruangbin", "La Luz"], 36],
  ["Mildlife", ["jazz fusion", "space disco"], ["Tame Impala", "Parcels"], 37],
  ["Ichiko Aoba", ["japanese folk", "ambient folk"], ["Joanna Newsom"], 52],
  ["Sofia Kourtesis", ["deep house", "peruvian electronic"], ["Four Tet", "Caribou"], 45],
  ["Kokoroko", ["afrobeat", "london jazz"], ["Ezra Collective", "Fela Kuti"], 47],
  ["Sessa", ["mpb", "tropicalia"], ["Caetano Veloso", "Devendra Banhart"], 35],
  ["Kikagaku Moyo", ["japanese psych", "krautrock"], ["Can", "King Gizzard"], 44],
  ["Yussef Dayes", ["uk jazz", "broken beat"], ["Tom Misch", "Kamaal Williams"], 54],
  ["Crumb", ["psych pop", "dream pop"], ["Men I Trust", "Tame Impala"], 53],
  ["Derya Yıldırım & Grup Şimşek", ["anatolian psych", "turkish folk"], ["Altın Gün"], 29],
  ["Pachyman", ["dub", "reggae"], ["King Tubby", "Khruangbin"], 31],
  ["Fievel Is Glauque", ["jazz pop", "art pop"], ["Stereolab"], 30],
]
const big = (u) => u?.replace(/\/\d+x\d+bb\.(jpg|png)$/, "/600x600bb.jpg") ?? null
const out = []
for (const [name, genres, sourceArtists, popularity] of picks) {
  const r = await fetch(`https://itunes.apple.com/search?entity=song&limit=25&term=${encodeURIComponent(name)}`)
  const j = await r.json()
  const key = (s) => s.normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase()
  const songs = j.results.filter((s) => s.previewUrl && key(s.artistName) === key(name))
  const seen = new Set()
  const tracks = songs.filter((s) => !seen.has(s.trackName) && seen.add(s.trackName)).slice(0, 3).map((s) => ({
    id: String(s.trackId), name: s.trackName, previewUrl: s.previewUrl, durationMs: s.trackTimeMillis,
    albumName: s.collectionName, albumImageUrl: big(s.artworkUrl100),
  }))
  if (!tracks.length) { console.error("skip (no previews):", name); continue }
  const imageUrl = tracks[0].albumImageUrl
  let color = "#8b5cf6", colorDark = "#1a1030", colorLight = "#d8c8ff"
  try {
    const p = await Vibrant.from(imageUrl).getPalette()
    color = (p.Vibrant ?? p.Muted)?.hex ?? color
    colorDark = (p.DarkVibrant ?? p.DarkMuted)?.hex ?? colorDark
    colorLight = (p.LightVibrant ?? p.LightMuted)?.hex ?? colorLight
  } catch (e) { console.error("palette failed:", name, e.message) }
  out.push({ id: key(name), name, genres, imageUrl, popularity, color, colorDark, colorLight, why: { sourceArtists, genres: genres.slice(0, 1) }, tracks })
  console.error("ok:", name, tracks.length, color)
  await new Promise((r) => setTimeout(r, 400))
}
writeFileSync("lib/lab/artists.json", JSON.stringify(out, null, 2))
console.error("wrote", out.length)

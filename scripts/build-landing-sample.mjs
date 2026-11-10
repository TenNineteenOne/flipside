// Builds data/landing-sample.json from the public iTunes Search API (real artwork + 30s previews)
// so the landing hero plays real audio without auth or a database. Run by hand:
// `npm run build:landing-sample`, then check `validateLandingSample` still passes (npm test).
import { Vibrant } from "node-vibrant/node"
import { writeFileSync } from "node:fs"

// [name, genres, sourceArtists, popularity]
const artists = [
  ["Glass Beams", ["psych rock", "indian fusion"], ["Khruangbin"], 46],
  ["YĪN YĪN", ["psychedelic funk", "thai funk"], ["Khruangbin", "Altın Gün"], 34],
  ["Altın Gün", ["anatolian rock", "psych folk"], ["Khruangbin"], 48],
  ["Mdou Moctar", ["tuareg rock", "desert blues"], ["Tinariwen", "Jimi Hendrix"], 44],
  ["Nala Sinephro", ["ambient jazz", "spiritual jazz"], ["Floating Points", "Alice Coltrane"], 41],
  ["Kokoroko", ["afrobeat", "london jazz"], ["Ezra Collective", "Fela Kuti"], 47],
]
// The "mini queue" illustration in step 3 of the explainer.
const queue = [
  ["Kikagaku Moyo", ["japanese psych", "krautrock"], ["Can", "King Gizzard"], 44],
  ["Arooj Aftab", ["neo-sufi", "chamber folk"], ["Nick Drake"], 43],
  ["Kokoroko", ["afrobeat", "london jazz"], ["Ezra Collective", "Fela Kuti"], 47],
  ["Fievel Is Glauque", ["jazz pop", "art pop"], ["Stereolab"], 30],
]

const big = (u) => u?.replace(/\/\d+x\d+bb\.(jpg|png)$/, "/600x600bb.jpg") ?? null
const key = (s) => s.normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase()

async function build([name, genres, sourceArtists, popularity]) {
  const r = await fetch(`https://itunes.apple.com/search?entity=song&limit=25&term=${encodeURIComponent(name)}`)
  const j = await r.json()
  const songs = j.results.filter((s) => s.previewUrl && key(s.artistName) === key(name))
  const seen = new Set()
  const picked = songs.filter((s) => !seen.has(s.trackName) && seen.add(s.trackName)).slice(0, 3)
  if (!picked.length) throw new Error(`no previews for ${name}`)
  const imageUrl = big(picked[0].artworkUrl100)
  let color = "#8b5cf6"
  try {
    const p = await Vibrant.from(imageUrl).getPalette()
    color = (p.Vibrant ?? p.Muted)?.hex ?? color
  } catch (e) { console.error("palette failed:", name, e.message) }
  const tracks = picked.map((s) => ({
    id: String(s.trackId), name: s.trackName, previewUrl: s.previewUrl, durationMs: s.trackTimeMillis, albumName: s.collectionName,
  }))
  console.error("ok:", name, tracks.length, color)
  await new Promise((res) => setTimeout(res, 400))
  return { id: key(name), name, genres, popularity, imageUrl, color, why: { sourceArtists, genres: genres.slice(0, 1) }, tracks }
}

const out = { artists: [], queue: [] }
for (const a of artists) out.artists.push(await build(a))
for (const a of queue) out.queue.push(await build(a))
writeFileSync("data/landing-sample.json", JSON.stringify(out, null, 2) + "\n")
console.error("wrote", out.artists.length, "+", out.queue.length)

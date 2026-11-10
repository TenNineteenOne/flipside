/**
 * A small deterministic avatar from a seed (the user id): a coloured background
 * with three overlapping shapes, after the DiceBear "shapes" style it replaces
 * (same palette, layer scales and offset/rotation ranges) without shipping it.
 * Pure: the same seed always gives the same markup.
 */
const PALETTE = ["#0a5b83", "#1c799f", "#69d2e7", "#f1f4dc", "#f88c49"]

const SHAPES = {
  rect: '<rect width="100" height="100"',
  ellipse: '<circle cx="50" cy="50" r="50"',
  polygon: '<path d="M50 0L100 100H0Z"',
} as const
type Shape = keyof typeof SHAPES

/** Layer scale, the shapes it may use, and its offset / rotation ranges (as in the old style). */
const LAYERS: { scale: number; shapes: Shape[]; offX: number; offY: number; rot: number }[] = [
  { scale: 1.2, shapes: ["rect", "ellipse", "polygon"], offX: 65, offY: 45, rot: 160 },
  { scale: 0.8, shapes: ["rect", "ellipse", "polygon"], offX: 40, offY: 40, rot: 180 },
  { scale: 0.4, shapes: ["rect", "ellipse", "polygon"], offX: 25, offY: 25, rot: 180 },
]

/** FNV-1a string hash seeding a mulberry32 generator. */
function rng(seed: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193)
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function identiconSvg(seed: string, size: number): string {
  const r = rng(seed || "user")
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
  const range = (n: number) => Math.round(r() * 2 * n - n)
  const bg = pick(PALETTE)
  const others = PALETTE.filter((c) => c !== bg)
  const layers = LAYERS.map((l) => {
    const offset = (100 - 100 * l.scale) / 2
    return `<g transform="matrix(${l.scale} 0 0 ${l.scale} ${offset} ${offset})"><g transform="translate(${range(l.offX)} ${range(l.offY)}) rotate(${range(l.rot)} 50 50)">${SHAPES[pick(l.shapes)]} fill="${pick(others)}"/></g></g>`
  }).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true"><rect width="100" height="100" fill="${bg}"/>${layers}</svg>`
}

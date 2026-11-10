// Turns the genre point cloud into map terrain: a density field, banded hypsometric tints coloured by the
// genres' own inks, and contour lines (marching squares) where the bands meet. Computed once per load.

export const CELL = 80
export const LEVELS = [0.07, 0.17, 0.32, 0.52, 0.78]
const ALPHA = [0, 0.15, 0.25, 0.36, 0.48, 0.6]

export interface Terrain {
  tint: HTMLCanvasElement
  /** World size the tint image covers. */
  w: number
  h: number
  contours: Path2D[]
}

export function buildTerrain(w: number, h: number, xy: number[], hex: string, bg: [number, number, number]): Terrain {
  const gw = Math.ceil(w / CELL) + 1, gh = Math.ceil(h / CELL) + 1
  const dens = new Float32Array(gw * gh), rs = new Float32Array(gw * gh), gs = new Float32Array(gw * gh), bs = new Float32Array(gw * gh)
  const R = 4, sig2 = 2 * 1.7 * 1.7
  const kernel: number[] = []
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) kernel.push(Math.exp(-(dx * dx + dy * dy) / sig2))
  const n = xy.length / 2
  for (let i = 0; i < n; i++) {
    const cx = xy[i * 2] / CELL, cy = xy[i * 2 + 1] / CELL
    const ix = Math.round(cx), iy = Math.round(cy)
    const c = parseInt(hex.substr(i * 6, 6), 16)
    const r = c >> 16, g = (c >> 8) & 255, b = c & 255
    let k = 0
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++, k++) {
        const x = ix + dx, y = iy + dy
        if (x < 0 || y < 0 || x >= gw || y >= gh) continue
        const wgt = kernel[k], j = y * gw + x
        dens[j] += wgt; rs[j] += r * wgt; gs[j] += g * wgt; bs[j] += b * wgt
      }
  }
  const sorted = Array.from(dens).filter((d) => d > 0.01).sort((a, b) => a - b)
  const top = sorted[Math.floor(sorted.length * 0.985)] || 1
  for (let j = 0; j < dens.length; j++) {
    if (dens[j] > 0) { rs[j] /= dens[j]; gs[j] /= dens[j]; bs[j] /= dens[j] }
    dens[j] = Math.min(1.2, dens[j] / top)
  }

  // Supersample the field so band edges come out as crisp flat layers, like printed hypsometric tints.
  const SS = 3, tw = gw * SS, th = gh * SS
  const tint = document.createElement("canvas")
  tint.width = tw; tint.height = th
  const ctx = tint.getContext("2d")!
  const img = ctx.createImageData(tw, th)
  for (let py = 0; py < th; py++) {
    const fy = Math.min(gh - 1.001, Math.max(0, (py + 0.5) / SS)), y0 = Math.floor(fy), ty = fy - y0
    for (let px = 0; px < tw; px++) {
      const fx = Math.min(gw - 1.001, Math.max(0, (px + 0.5) / SS)), x0 = Math.floor(fx), tx = fx - x0
      const a00 = y0 * gw + x0, a10 = a00 + 1, a01 = a00 + gw, a11 = a01 + 1
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty
      const d = dens[a00] * w00 + dens[a10] * w10 + dens[a01] * w01 + dens[a11] * w11
      let band = 0
      while (band < LEVELS.length && d >= LEVELS[band]) band++
      const o = (py * tw + px) * 4
      if (!band) { img.data[o] = bg[0]; img.data[o + 1] = bg[1]; img.data[o + 2] = bg[2]; img.data[o + 3] = 255; continue }
      const r = rs[a00] * w00 + rs[a10] * w10 + rs[a01] * w01 + rs[a11] * w11
      const g = gs[a00] * w00 + gs[a10] * w10 + gs[a01] * w01 + gs[a11] * w11
      const b = bs[a00] * w00 + bs[a10] * w10 + bs[a01] * w01 + bs[a11] * w11
      // Push the averaged ink away from grey so the bands read as colour, not mud.
      const m = (r + g + b) / 3
      const sat = (v: number) => Math.max(0, Math.min(255, m + (v - m) * 1.7))
      const a = ALPHA[band]
      img.data[o] = bg[0] * (1 - a) + sat(r) * a
      img.data[o + 1] = bg[1] * (1 - a) + sat(g) * a
      img.data[o + 2] = bg[2] * (1 - a) + sat(b) * a
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  const contours = LEVELS.map((lv) => marchingSquares(dens, gw, gh, lv))
  return { tint, contours, w: gw * CELL, h: gh * CELL }
}

/** Classic marching squares; emits unjoined segments in world units (fine for stroking). */
function marchingSquares(f: Float32Array, gw: number, gh: number, lv: number): Path2D {
  const p = new Path2D()
  const lerp = (a: number, b: number) => (lv - a) / (b - a || 1e-6)
  for (let y = 0; y < gh - 1; y++)
    for (let x = 0; x < gw - 1; x++) {
      const tl = f[y * gw + x], tr = f[y * gw + x + 1], br = f[(y + 1) * gw + x + 1], bl = f[(y + 1) * gw + x]
      const c = (tl >= lv ? 8 : 0) | (tr >= lv ? 4 : 0) | (br >= lv ? 2 : 0) | (bl >= lv ? 1 : 0)
      if (c === 0 || c === 15) continue
      const T = [(x + lerp(tl, tr)) * CELL, y * CELL]
      const Rr = [(x + 1) * CELL, (y + lerp(tr, br)) * CELL]
      const B = [(x + lerp(bl, br)) * CELL, (y + 1) * CELL]
      const L = [x * CELL, (y + lerp(tl, bl)) * CELL]
      const seg = (a: number[], b: number[]) => { p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]) }
      switch (c) {
        case 1: case 14: seg(L, B); break
        case 2: case 13: seg(B, Rr); break
        case 3: case 12: seg(L, Rr); break
        case 4: case 11: seg(T, Rr); break
        case 5: seg(L, T); seg(B, Rr); break
        case 6: case 9: seg(T, B); break
        case 7: case 8: seg(L, T); break
        case 10: seg(T, Rr); seg(L, B); break
      }
    }
  return p
}

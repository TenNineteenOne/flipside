"use client"

import { useLayoutEffect, useRef } from "react"
import { labArtists, type LabArtist } from "@/lib/lab/artists"
import { inkOf, rgb } from "./drop-core"

const BLUE = rgb("#1b2b8f")
// 7px threshold cell: white centre (inks first) fading to black edge, tiled into a halftone screen.
const DOT =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='7' height='7'><defs><radialGradient id='r'><stop offset='0' stop-color='#fff'/><stop offset='1' stop-color='#000'/></radialGradient></defs><rect width='7' height='7' fill='url(#r)'/></svg>",
  )

/** SVG filters, mounted once per page: one single-ink tone per artist + a shared blue halftone plate. */
export function InkDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
      <defs>
        {labArtists.map((a) => {
          const c = rgb(inkOf(a))
          // shadows print full ink, highlights a light tint of it, so even a white cover reads as printed
          const tone = (i: number) => `${c[i]} ${c[i] * 0.45 + 0.55}`
          return (
            <filter key={a.id} id={`drop-ink-${a.id}`} colorInterpolationFilters="sRGB">
              <feColorMatrix type="saturate" values="0" />
              <feComponentTransfer>
                <feFuncR type="table" tableValues={tone(0)} />
                <feFuncG type="table" tableValues={tone(1)} />
                <feFuncB type="table" tableValues={tone(2)} />
              </feComponentTransfer>
            </filter>
          )
        })}
        <filter id="drop-ht" x="0" y="0" width="1" height="1" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feImage href={DOT} x="0" y="0" width="7" height="7" preserveAspectRatio="none" result="cell" />
          <feTile in="cell" result="dots" />
          {/* lighten first so only the shadows print in blue */}
          <feColorMatrix in="SourceGraphic" type="matrix" values=".19 .38 .07 0 .38  .19 .38 .07 0 .38  .19 .38 .07 0 .38  0 0 0 0 1" result="g" />
          <feComposite in="g" in2="dots" operator="arithmetic" k2="1" k3="-1" k4=".5" result="d" />
          <feComponentTransfer in="d" result="bin">
            <feFuncR type="discrete" tableValues="0 1" />
            <feFuncG type="discrete" tableValues="0 1" />
            <feFuncB type="discrete" tableValues="0 1" />
          </feComponentTransfer>
          <feColorMatrix in="bin" type="matrix" values={`0 0 0 0 ${BLUE[0]}  0 0 0 0 ${BLUE[1]}  0 0 0 0 ${BLUE[2]}  -1 0 0 0 1`} />
        </filter>
      </defs>
    </svg>
  )
}

/** Album art as a two-ink riso print: the artist's ink for tone, blue halftone overprinted for shadow. */
export function Art({ artist, eager, className = "" }: { artist: LabArtist; eager?: boolean; className?: string }) {
  const loading = eager ? "eager" : "lazy"
  /* eslint-disable @next/next/no-img-element -- brief: plain <img> for mzstatic art (next/image is unoptimized here) */
  return (
    <div className={`d-art ${className}`}>
      <img src={artist.imageUrl} alt={`${artist.name} album cover`} width={600} height={600} loading={loading} draggable={false} style={{ filter: `url(#drop-ink-${artist.id})` }} />
      <img src={artist.imageUrl} alt="" aria-hidden="true" width={600} height={600} loading={loading} draggable={false} className="d-plate" />
      {/* eslint-enable @next/next/no-img-element */}
    </div>
  )
}

/** Wood-type setting: long names break onto two lines, each line set full-width. */
export function PosterName({ name, max = 150, className = "" }: { name: string; max?: number; className?: string }) {
  const lines = splitName(name)
  return (
    <span className={`d-name ${className}`}>
      {lines.map((l, i) => (
        <FitLine key={i} text={l} max={max} />
      ))}
    </span>
  )
}

function splitName(name: string): string[] {
  if (name.length <= 11 || !name.includes(" ")) return [name]
  const mid = name.length / 2
  let best = -1
  for (let i = 0; i < name.length; i++) if (name[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i
  return [name.slice(0, best), name.slice(best + 1)]
}

function FitLine({ text, max }: { text: string; max: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  // Short words go extended, long ones condensed, like picking wood type from the case.
  const wdth = text.length <= 5 ? 130 : text.length <= 8 ? 100 : text.length <= 11 ? 78 : 62
  useLayoutEffect(() => {
    const el = ref.current
    const box = el?.parentElement
    if (!el || !box) return
    const fit = () => {
      el.style.fontSize = "100px"
      const w = el.scrollWidth
      if (w) el.style.fontSize = `${Math.min(max, (100 * box.clientWidth) / w) * 0.99}px`
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    document.fonts?.ready.then(fit)
    return () => ro.disconnect()
  }, [text, max])
  return (
    <span ref={ref} className="d-line" style={{ fontVariationSettings: `'wdth' ${wdth}`, ["--n" as string]: text.length }}>
      {text}
    </span>
  )
}

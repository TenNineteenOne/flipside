// Dev-preview only. Production code must never import from lib/dev-preview.
import type { RailKey, RailPayload } from "@/lib/cards/explore-rail-payloads"
import { previewArtists } from "./fixtures"

/**
 * Explore rails built from the 19 preview artists: After hours 7, Rabbit holes 5, Uncharted 6 and
 * Curveballs empty (hidden: the client drops rails under 5 picks). With Adventurous on, the "server"
 * inflates Curveballs to 5 (including the no-image/no-tracks artist), as the real engine inflates
 * Left-field. Each generation rotates every rail by two, so a Shuffle visibly reorders the cards.
 */
const BASE: Record<RailKey, number[]> = {
  adjacent: [0, 1, 2, 3, 4, 5, 6],
  wildcards: [7, 8, 9, 10, 11],
  outside: [12, 13, 14, 15, 16, 17],
  leftfield: [],
}
// Copied from RAIL_TITLES (lib/cards/explore-rail-payloads.ts): that module pulls in the server-only
// explore engine, which the client-side stub cannot import.
const RAIL_TITLES: Record<RailKey, { title: string; subtitle: string; empty: string }> = {
  adjacent: { title: "After hours", subtitle: "Ambient, hushed, and late-night — a dimmer shelf to browse", empty: "Hang tight — the moodier corners are loading." },
  outside: { title: "Uncharted territory", subtitle: "Corners of the sonic map you've never set foot in", empty: "Listen a little first — we need to know where the edges are." },
  wildcards: { title: "Rabbit holes", subtitle: "Deep cuts spun off the artists you've starred", empty: "Thumbs-up an artist and the rabbit hole opens up." },
  leftfield: { title: "Curveballs", subtitle: "A blind pick from the sonic map — good luck", empty: "Nothing yet — regenerate for another throw." },
}
const ADVENTUROUS_LEFTFIELD = [18, 3, 8, 10, 14]

export function previewRails({ adventurous, generation, cold = false }: { adventurous: boolean; generation: number; cold?: boolean }): RailPayload[] {
  return (Object.keys(BASE) as RailKey[]).map((railKey) => {
    const idx = cold ? [] : railKey === "leftfield" && adventurous ? ADVENTUROUS_LEFTFIELD : BASE[railKey]
    const shift = idx.length ? (generation * 2) % idx.length : 0
    const order = [...idx.slice(shift), ...idx.slice(0, shift)]
    const meta = RAIL_TITLES[railKey]
    return {
      railKey,
      title: meta.title,
      subtitle: meta.subtitle,
      artists: order.map((i) => previewArtists[i]),
      emptyCaption: meta.empty,
    }
  })
}

export const PREVIEW_CHALLENGE = {
  title: "Genre hopper",
  description: "Like artists from 5 genres you haven't explored",
  progress: 2,
  target: 5,
  completed: false,
}

/** Fixed timestamp of the "cached" rails the page renders with. */
export const PREVIEW_GENERATED_AT = "2026-11-01T00:00:00.000Z"

"use client"

import { useMemo, useState } from "react"
import { labArtists, type LabArtist } from "@/lib/lab/artists"
import type { AtlasPin, AtlasSetup } from "./types"
import type { Flag, PinView } from "./atlas-map"

export const RANGES = [
  { r: 2.4, label: "Close to home" },
  { r: 3.6, label: "Over the border" },
  { r: 5.5, label: "Far afield" },
  { r: 8.5, label: "Another continent" },
  { r: 14, label: "Off the edge" },
]

export type PinStatus = "open" | "flag" | "dismissed" | "avoid"
export interface Entry { pin: AtlasPin; artist: LabArtist }

const byId = new Map(labArtists.map((a) => [a.id, a]))

/** All local state for the signed-in map: what you planted, ruled out, saved, and how far out you look. */
export function useAtlas(setup: AtlasSetup, initialRange = 1) {
  const [status, setStatus] = useState<Record<string, PinStatus>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [flags, setFlags] = useState<(Flag & { id: string })[]>([])
  const [range, setRange] = useState(initialRange)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [visited, setVisited] = useState<string[]>([])

  const entries: Entry[] = useMemo(() => setup.pins.map((pin) => ({ pin, artist: byId.get(pin.artistId)! })), [setup])
  const sourceAt = useMemo(() => new Map(setup.sources.map((s) => [s.label, s])), [setup])
  const avoid = useMemo(() => entries.filter((e) => status[e.pin.artistId] === "avoid").map((e) => ({ x: e.pin.x, y: e.pin.y })), [entries, status])
  const radius = RANGES[range].r

  const pins: PinView[] = useMemo(
    () =>
      entries
        .filter((e) => status[e.pin.artistId] !== "dismissed" && status[e.pin.artistId] !== "avoid")
        .map(({ pin, artist }) => {
          const st = status[pin.artistId]
          const src = sourceAt.get(pin.source)!
          const fogged = avoid.some((a) => Math.hypot(a.x - pin.x, a.y - pin.y) < 1300)
          return {
            id: pin.artistId, name: artist.name, imageUrl: artist.imageUrl, x: pin.x, y: pin.y, sx: src.x, sy: src.y,
            saved: !!saved[pin.artistId],
            state: st === "flag" ? "flag" : pin.reach > radius && !saved[pin.artistId] ? "hidden" : fogged ? "faded" : "open",
          }
        }),
    [entries, status, saved, avoid, radius, sourceAt],
  )
  const visible = entries.filter((e) => pins.some((p) => p.id === e.pin.artistId && p.state !== "hidden")).sort((a, b) => a.pin.reach - b.pin.reach)
  const uncharted = pins.filter((p) => p.state === "hidden").length

  const set = (id: string, s: PinStatus | undefined) => setStatus((m) => { const n = { ...m }; if (s) n[id] = s; else delete n[id]; return n })
  const actions = {
    select: (id: string | null) => {
      setSelectedId(id)
      if (id) setVisited((v) => [id, ...v.filter((x) => x !== id)])
    },
    plant: (id: string) => {
      const e = entries.find((x) => x.pin.artistId === id)!
      set(id, "flag")
      setFlags((f) => [...f, { id, x: e.pin.x, y: e.pin.y, t0: performance.now() }])
    },
    unplant: (id: string) => { set(id, undefined); setFlags((f) => f.filter((x) => x.id !== id)) },
    avoid: (id: string) => set(id, "avoid"),
    dismiss: (id: string) => set(id, "dismissed"),
    restore: (id: string) => set(id, undefined),
    toggleSave: (id: string) => setSaved((m) => ({ ...m, [id]: !m[id] })),
    setRange,
  }
  return { entries, pins, visible, uncharted, flags, avoid, radius, range, status, saved, selectedId, visited, actions }
}

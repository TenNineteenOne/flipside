"use client"

import { useState } from "react"
import { GenrePicker } from "@/components/onboarding/genre-picker"
import { MAX_SELECTED_GENRES } from "@/lib/settings/patch-settings"
import type { GenreNode } from "@/lib/types"

/** Onboarding's genre picker with local state, as the onboarding page uses it; the saved value is shown below. */
export default function GenrePickerPreview() {
  const [selected, setSelected] = useState<GenreNode[]>([])
  const toggle = (node: GenreNode) =>
    setSelected((prev) =>
      prev.some((g) => g.id === node.id) ? prev.filter((g) => g.id !== node.id) : prev.length < MAX_SELECTED_GENRES ? [...prev, node] : prev,
    )
  return (
    <>
      <GenrePicker selected={selected} onToggle={toggle} cap={MAX_SELECTED_GENRES} />
      <pre id="saved-value" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(selected.map((g) => g.lastfmTag))}</pre>
    </>
  )
}

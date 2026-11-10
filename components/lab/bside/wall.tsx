"use client"
/* eslint-disable @next/next/no-img-element -- lab brief: plain <img> for CSP-allowed mzstatic art */

import { Pause, Play } from "lucide-react"
import { labArtists } from "@/lib/lab/artists"
import { themeVars } from "./color"
import { useDeck } from "./sleeve"

/** The new-arrivals wall: every record in this week's crate, one tap to hear it. */
export function Wall() {
  const deck = useDeck()
  return (
    <ul className="bs-wall">
      {labArtists.map((a) => {
        const on = deck.owns(a) && deck.isPlaying
        return (
          <li key={a.id} style={themeVars(a)}>
            <button type="button" onClick={() => deck.toggle(a)} aria-pressed={on} aria-label={`${on ? "Pause" : "Play"} ${a.topTracks[0].name} by ${a.name}`}>
              <img src={a.imageUrl} alt="" width={600} height={600} loading="lazy" />
              <span className="bs-wall-tag">
                <strong>{a.name}</strong>
                <span>{a.genres[0]}</span>
                {on ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

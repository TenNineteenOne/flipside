"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Radio, STATIONS } from "./radio"

/**
 * Lean-back playback: one Radio, a current station + track, auto-advance on `ended`.
 * `next(cur)` decides the following station so the app can bias it (lock in / skip).
 */
export function useTuner(initial: number, next: (cur: number, played: Set<string>) => number, demo = false) {
  const radioRef = useRef<Radio | null>(null)
  const nextRef = useRef(next)
  const tuneRef = useRef<(i: number, t?: number) => void>(() => {})
  const playedRef = useRef(new Set<string>())
  const [played, setPlayed] = useState(() => new Set<string>())
  const [index, setIndex] = useState(initial)
  const [track, setTrack] = useState(0)
  const [on, setOn] = useState(demo)
  const [snap, setSnap] = useState({ playing: false, buffering: false, progress: 0 })
  const pos = useRef({ index: initial, track: 0 })

  useEffect(() => {
    nextRef.current = next
  })

  const radio = useCallback(() => {
    if (!radioRef.current) {
      const r = new Radio()
      r.onChange = () => setSnap({ playing: r.playing, buffering: r.buffering, progress: r.progress })
      r.onEnded = () => tuneRef.current(nextRef.current(pos.current.index, playedRef.current), 0)
      radioRef.current = r
    }
    return radioRef.current
  }, [])

  const tune = useCallback(
    (i: number, t = 0) => {
      const s = STATIONS[i]
      const url = s?.artist.topTracks[t]?.previewUrl
      pos.current = { index: i, track: t }
      setIndex(i)
      setTrack(t)
      setOn(true)
      if (s && !playedRef.current.has(s.artist.id)) {
        playedRef.current = new Set(playedRef.current).add(s.artist.id)
        setPlayed(playedRef.current)
      }
      if (url) void radio().load(url)
    },
    [radio],
  )
  useEffect(() => {
    tuneRef.current = tune
  }, [tune])

  const toggle = useCallback(() => {
    const r = radio()
    if (r.playing || r.buffering) void r.pause()
    else if (!r.resume()) tune(pos.current.index, pos.current.track)
  }, [radio, tune])

  useEffect(
    () => () => {
      radioRef.current?.dispose()
      radioRef.current = null
    },
    [],
  )
  /** For the visualiser's rAF loop: never creates a Radio. */
  const peek = useCallback(() => radioRef.current, [])

  // Media Session: headphone buttons and the OS media keys drive the radio too.
  const st = STATIONS[index]
  useEffect(() => {
    if (!on || !("mediaSession" in navigator)) return
    const t = st.artist.topTracks[track]
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t?.name ?? st.artist.name,
      artist: st.artist.name,
      album: `Flipside FM ${st.freq.toFixed(1)}`,
      artwork: [{ src: st.artist.imageUrl, sizes: "600x600", type: "image/jpeg" }],
    })
    const ms = navigator.mediaSession
    ms.setActionHandler("play", toggle)
    ms.setActionHandler("pause", toggle)
    ms.setActionHandler("nexttrack", () => tune(nextRef.current(pos.current.index, playedRef.current)))
    return () => {
      ms.setActionHandler("play", null)
      ms.setActionHandler("pause", null)
      ms.setActionHandler("nexttrack", null)
    }
  }, [on, st, track, toggle, tune])

  return {
    index,
    track,
    on,
    playing: demo || snap.playing,
    buffering: snap.buffering,
    progress: demo ? 0.38 : snap.progress,
    tune,
    toggle,
    radio,
    peek,
    played,
  }
}
export type Tuner = ReturnType<typeof useTuner>

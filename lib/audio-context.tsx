"use client"

import { createContext, useContext, useRef, useState, useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react"
import type { Track } from "@/lib/music-provider/types"

interface AudioState {
  currentTrack: Track | null
  artistName: string
  artistImageUrl: string | null
  artistColor: string | null
  isPlaying: boolean
}

interface AudioContextValue extends AudioState {
  play: (track: Track, artistName: string, artistImageUrl: string | null, artistColor?: string | null) => void
  pause: () => void
  resume: () => void
  stop: () => void
}

export const AudioContext = createContext<AudioContextValue | null>(null)

export function useAudio() {
  const ctx = useContext(AudioContext)
  if (!ctx) throw new Error("useAudio must be used inside AudioProvider")
  return ctx
}

// Progress ticks every 250ms while playing, so it lives outside AudioContext:
// only components that draw a progress bar subscribe, instead of every useAudio()
// consumer (the whole feed tree) re-rendering on each tick.
interface ProgressStore { subscribe: (l: () => void) => () => void; get: () => number }
const ProgressContext = createContext<ProgressStore | null>(null)
const zero = () => 0

/** Playback progress 0..1. With `active` false it returns 0 and never re-renders on ticks. */
export function useAudioProgress(active = true) {
  const store = useContext(ProgressContext)
  if (!store) throw new Error("useAudioProgress must be used inside AudioProvider")
  return useSyncExternalStore(store.subscribe, active ? store.get : zero, zero)
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [state, setState] = useState<AudioState>({
    currentTrack: null,
    artistName: "",
    artistImageUrl: null,
    artistColor: null,
    isPlaying: false,
  })
  const progressRef = useRef(0)
  const listenersRef = useRef(new Set<() => void>())
  const setProgress = useCallback((p: number) => {
    if (progressRef.current === p) return
    progressRef.current = p
    listenersRef.current.forEach((l) => l())
  }, [])
  const progressStore = useMemo<ProgressStore>(() => ({
    subscribe: (l) => { listenersRef.current.add(l); return () => { listenersRef.current.delete(l) } },
    get: () => progressRef.current,
  }), [])

  const play = useCallback((track: Track, artistName: string, artistImageUrl: string | null, artistColor?: string | null) => {
    if (!track.previewUrl) return

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ""
    }

    const audio = new Audio(track.previewUrl)
    audioRef.current = audio

    audio.ontimeupdate = () => {
      if (throttleRef.current) return
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null
      }, 250)
      const dur = audio.duration
      if (!dur || isNaN(dur)) return
      const p = Math.max(0, Math.min(1, audio.currentTime / dur))
      setProgress(p)
    }

    // play() can reject (e.g. expired preview URL) after we've already set
    // isPlaying: true below — roll the state back rather than leaving a ghost
    // "playing" MiniPlayer. Guard against a newer play()/stop() call having
    // superseded this audio element by the time the rejection/error fires.
    audio.play().catch(() => {
      if (audioRef.current !== audio) return
      setState(prev => ({ ...prev, isPlaying: false }))
    })
    audio.onended = () => {
      setProgress(1)
      setState(prev => ({ ...prev, isPlaying: false }))
    }
    audio.onerror = () => {
      if (audioRef.current !== audio) return
      setState(prev => ({ ...prev, isPlaying: false }))
    }

    setProgress(0)
    setState({ currentTrack: track, artistName, artistImageUrl, artistColor: artistColor ?? null, isPlaying: true })
  }, [setProgress])

  const pause = useCallback(() => {
    audioRef.current?.pause()
    setState(prev => ({ ...prev, isPlaying: false }))
  }, [])

  const resume = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.play().catch(() => {
      if (audioRef.current !== audio) return
      setState(prev => ({ ...prev, isPlaying: false }))
    })
    setState(prev => ({ ...prev, isPlaying: true }))
  }, [])

  const stop = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    setProgress(0)
    setState({ currentTrack: null, artistName: "", artistImageUrl: null, artistColor: null, isPlaying: false })
  }, [setProgress])

  useEffect(() => {
    return () => {
      if (throttleRef.current) clearTimeout(throttleRef.current)
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ""
        audioRef.current = null
      }
    }
  }, [])

  const value = useMemo(() => ({ ...state, play, pause, resume, stop }), [state, play, pause, resume, stop])

  return (
    <AudioContext.Provider value={value}>
      <ProgressContext.Provider value={progressStore}>{children}</ProgressContext.Provider>
    </AudioContext.Provider>
  )
}

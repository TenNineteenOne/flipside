"use client"

import { createContext, useContext, useRef, useState, useCallback, useEffect, type ReactNode } from "react"
import type { Track } from "@/lib/music-provider/types"

interface AudioState {
  currentTrack: Track | null
  artistName: string
  artistImageUrl: string | null
  artistColor: string | null
  isPlaying: boolean
  progress: number
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

export function AudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [state, setState] = useState<AudioState>({
    currentTrack: null,
    artistName: "",
    artistImageUrl: null,
    artistColor: null,
    isPlaying: false,
    progress: 0,
  })

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
      setState(prev => ({ ...prev, progress: p }))
    }

    audio.play().catch(() => {})
    audio.onended = () => setState(prev => ({ ...prev, isPlaying: false, progress: 1 }))

    setState({ currentTrack: track, artistName, artistImageUrl, artistColor: artistColor ?? null, isPlaying: true, progress: 0 })
  }, [])

  const pause = useCallback(() => {
    audioRef.current?.pause()
    setState(prev => ({ ...prev, isPlaying: false }))
  }, [])

  const resume = useCallback(() => {
    if (!audioRef.current) return
    audioRef.current.play().catch(() => {})
    setState(prev => ({ ...prev, isPlaying: true }))
  }, [])

  const stop = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    setState({ currentTrack: null, artistName: "", artistImageUrl: null, artistColor: null, isPlaying: false, progress: 0 })
  }, [])

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

  return (
    <AudioContext.Provider value={{ ...state, play, pause, resume, stop }}>
      {children}
    </AudioContext.Provider>
  )
}

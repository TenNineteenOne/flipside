"use client"

import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from "react"
import type { Track } from "@/lib/music-provider/types"

interface AudioState {
  currentTrack: Track | null
  artistName: string
  artistImageUrl: string | null
  isPlaying: boolean
}

interface AudioContextValue extends AudioState {
  play: (track: Track, artistName: string, artistImageUrl: string | null) => void
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
  const [state, setState] = useState<AudioState>({
    currentTrack: null,
    artistName: "",
    artistImageUrl: null,
    isPlaying: false,
  })

  const play = useCallback((track: Track, artistName: string, artistImageUrl: string | null) => {
    if (!track.previewUrl) return

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ""
    }

    const audio = new Audio(track.previewUrl)
    audioRef.current = audio
    audio.play().catch(() => {})
    audio.onended = () => setState(prev => ({ ...prev, isPlaying: false }))

    setState({ currentTrack: track, artistName, artistImageUrl, isPlaying: true })
  }, [])

  const pause = useCallback(() => {
    audioRef.current?.pause()
    setState(prev => ({ ...prev, isPlaying: false }))
  }, [])

  const resume = useCallback(() => {
    audioRef.current?.play().catch(() => {})
    setState(prev => ({ ...prev, isPlaying: true }))
  }, [])

  const stop = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    setState({ currentTrack: null, artistName: "", artistImageUrl: null, isPlaying: false })
  }, [])

  return (
    <AudioContext.Provider value={{ ...state, play, pause, resume, stop }}>
      {children}
    </AudioContext.Provider>
  )
}

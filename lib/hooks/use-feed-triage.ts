"use client"

import { useCallback, useMemo, useState } from "react"
import { useAudio } from "@/lib/audio-context"
import { artworkFor } from "@/lib/feed/artwork"
import { decide, type Plan } from "@/lib/feed/decision"
import { counts, firstUndecided, remaining, visibleQueue, type Signal } from "@/lib/feed/triage-queue"
import { resolveArtistColor } from "@/lib/color-utils"
import { useArtistFeedback } from "@/lib/hooks/use-artist-feedback"
import { useArtistSaves } from "@/lib/hooks/use-artist-saves"
import type { CardArtist } from "@/lib/cards/card-artist"
import type { Track } from "@/lib/music-provider/types"

export interface JudgeOptions {
  /** true for buttons/keys (repeat "more" un-likes); false for a swipe. */
  toggle: boolean
  /** Move the selection on when the judged artist is the selected one. */
  advance: boolean
}

/**
 * The feed's triage state (PRD #182, Modules 6): selection, verdicts (read only
 * from the feedback hook's `signals`), playback per artist, and `judge`, which
 * runs the pure decision core and executes its plan. Every feed presentation
 * (desktop, legacy list, later Snap/tablet) reads the same object.
 */
export function useFeedTriage(artists: CardArtist[]) {
  const audio = useAudio()
  // Same error copy the feed has always passed.
  const { signals, setSignal } = useArtistFeedback({
    errorMessages: {
      undoFailed: "Couldn't undo — try again",
      saveFailed: "Couldn't save feedback — try again",
    },
  })
  const { savedIds, toggleSave } = useArtistSaves()

  const ids = useMemo(() => artists.map((a) => a.id), [artists])
  const byId = useMemo(() => new Map(artists.map((a) => [a.id, a])), [artists])
  const [selectedId, setSelectedId] = useState<string | null>(() => firstUndecided(ids, signals))
  const [lastPlan, setLastPlan] = useState<Plan | null>(null)

  // Tracks fetched on demand (useArtistTracks) for artists that arrived without any.
  const [fetched, setFetched] = useState<ReadonlyMap<string, Track[]>>(new Map())
  const addTracks = useCallback(
    (id: string, tracks: Track[]) => setFetched((m) => (m.get(id) === tracks ? m : new Map(m).set(id, tracks))),
    [],
  )
  const tracksOf = useCallback(
    (a: CardArtist): Track[] => (a.topTracks.length > 0 ? a.topTracks : fetched.get(a.id) ?? []),
    [fetched],
  )

  const current = audio.currentTrack
  const owns = useCallback((a: CardArtist) => !!current && tracksOf(a).some((t) => t.id === current.id), [current, tracksOf])
  /** The artist whose track is loaded in the player (playing or paused), or null. */
  const nowPlayingArtist = useMemo(() => (current ? artists.find(owns) ?? null : null), [current, artists, owns])
  const playingArtistId = audio.isPlaying ? nowPlayingArtist?.id ?? null : null
  const isPlaying = useCallback((a: CardArtist) => a.id === playingArtistId, [playingArtistId])

  const { play, pause, resume } = audio
  const playArtist = useCallback(
    (a: CardArtist, index = 0) => {
      const playable = tracksOf(a).filter((t) => t.previewUrl)
      const t = playable[index]
      if (t) play(t, a.name, artworkFor(a), resolveArtistColor(a.artistColor, a.name))
      else pause()
    },
    [tracksOf, play, pause],
  )

  const togglePlay = useCallback(
    (a: CardArtist) => {
      if (!owns(a)) playArtist(a)
      else if (audio.isPlaying) pause()
      else resume()
    },
    [owns, playArtist, audio.isPlaying, pause, resume],
  )

  const judge = useCallback(
    (artistId: string, signal: Signal, opts: JudgeOptions): Plan | null => {
      const a = byId.get(artistId)
      if (!a) return null
      const plan = decide({ ids, signals, selectedId, playingArtistId }, { artistId, name: a.name, signal, ...opts })
      if (plan.send.kind === "set") void setSignal(artistId, plan.send.signal)
      setSelectedId(plan.selectId)
      if (plan.audio.kind === "play") {
        const next = byId.get(plan.audio.artistId)
        if (next) playArtist(next)
      } else if (plan.audio.kind === "pause") pause()
      setLastPlan(plan)
      return plan
    },
    [byId, ids, signals, selectedId, playingArtistId, setSignal, playArtist, pause],
  )

  const visible = useMemo(
    () => visibleQueue(ids, signals).map((id) => byId.get(id)!),
    [ids, signals, byId],
  )

  return {
    /** Every loaded artist id, in feed order (the progress strip). */
    ids,
    signals,
    setSignal,
    savedIds,
    toggleSave,
    selectedId,
    selected: selectedId ? byId.get(selectedId) ?? null : null,
    select: setSelectedId,
    visible,
    remaining: remaining(ids, signals),
    total: ids.length,
    counts: counts(ids, signals),
    nowPlayingArtist,
    isPlaying,
    togglePlay,
    addTracks,
    judge,
    lastPlan,
  }
}

export type FeedTriage = ReturnType<typeof useFeedTriage>

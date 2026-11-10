"use client"

import { createElement, Fragment, useCallback, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Undo2 } from "lucide-react"
import { useAudio } from "@/lib/audio-context"
import { artworkFor } from "@/lib/feed/artwork"
import { decide, type Plan } from "@/lib/feed/decision"
import { whyText } from "@/lib/feed/card-copy"
import { counts, firstUndecided, reconcileSelection, remaining, step, visibleQueue, type Signal } from "@/lib/feed/triage-queue"
import { tuning } from "@/lib/feed/tuning"
import { getArtistLink, getShareableArtistLink, type MusicPlatform } from "@/lib/music-links"
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
const TOAST_ID = "feed-triage"
const TOAST_MS = 5000

type Undo = NonNullable<Plan["undo"]>

// Prototype's Undo: icon, label and the Z key hint (hidden on touch / narrow screens by feed.css).
const UNDO_LABEL = createElement(
  Fragment,
  null,
  createElement(Undo2, { size: 14, "aria-hidden": true }),
  "Undo",
  createElement("kbd", { className: "ev-kbd", "aria-hidden": true }, "Z"),
)

const linkRef = (a: CardArtist) => ({ artistId: a.id, spotifyId: a.spotifyId ?? null, artistName: a.name })

export function useFeedTriage(artists: CardArtist[], musicPlatform: MusicPlatform) {
  const audio = useAudio()
  // Same error copy the feed has always passed.
  const { signals, setSignal, removeSignal, dismiss } = useArtistFeedback({
    errorMessages: {
      undoFailed: "Couldn't undo — try again",
      saveFailed: "Couldn't save feedback — try again",
    },
  })
  const { savedIds, toggleSave } = useArtistSaves()

  const ids = useMemo(() => artists.map((a) => a.id), [artists])
  const byId = useMemo(() => new Map(artists.map((a) => [a.id, a])), [artists])
  const [chosenId, setSelectedId] = useState<string | null>(() => firstUndecided(ids, signals))
  // Derived, not synced: appends keep the selection; at the end of the queue (null)
  // the first newly arrived undecided artist is selected.
  const selectedId = reconcileSelection(ids, signals, chosenId)
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

  /** Play track `index` of the artist's playable tracks; the playing one toggles pause/resume. */
  const playTrack = useCallback(
    (a: CardArtist, index: number) => {
      const t = tracksOf(a).filter((x) => x.previewUrl)[index]
      if (!t || current?.id !== t.id) playArtist(a, index)
      else if (audio.isPlaying) pause()
      else resume()
    },
    [tracksOf, current, playArtist, audio.isPlaying, pause, resume],
  )

  // One toast at a time (stable id): a new decision or save replaces the last.
  // The undo stays available exactly as long as its toast is up.
  const undoRef = useRef<{ undo: Undo; token: object } | null>(null)

  /** Undo the most recent decision while its toast is showing, then reselect that artist. No-op otherwise. */
  const undoLast = useCallback(() => {
    const u = undoRef.current?.undo
    if (!u) return
    undoRef.current = null
    toast.dismiss(TOAST_ID)
    if (u.kind === "setThumbsUpAgain") void setSignal(u.artistId, "thumbs_up")
    else if (u.kind === "removeSignal") void removeSignal(u.artistId)
    else void dismiss(u.artistId)
    setSelectedId(u.artistId)
  }, [setSignal, removeSignal, dismiss])

  const notify = useCallback(
    (message: string, undo: Undo | null = null) => {
      const token = {}
      undoRef.current = undo ? { undo, token } : null
      const expire = () => { if (undoRef.current?.token === token) undoRef.current = null }
      toast(message, {
        id: TOAST_ID,
        duration: TOAST_MS,
        unstyled: true,
        position: "bottom-left",
        classNames: { toast: "ev-toast", title: "ev-toast-text", actionButton: "ev-toast-undo" },
        action: undo ? { label: UNDO_LABEL, onClick: undoLast } : undefined,
        onAutoClose: expire,
        onDismiss: expire,
      })
    },
    [undoLast],
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
      if (plan.message) notify(plan.message, plan.undo)
      return plan
    },
    [byId, ids, signals, selectedId, playingArtistId, setSignal, playArtist, pause, notify],
  )

  const save = useCallback(
    (a: CardArtist) => {
      const was = savedIds.has(a.id)
      void toggleSave(a.id)
      notify(was ? `Removed ${a.name} from Saved` : `Saved ${a.name}`)
    },
    [savedIds, toggleSave, notify],
  )

  /** The artist on the user's preferred platform. */
  const artistLink = useCallback((a: CardArtist) => getArtistLink(musicPlatform, linkRef(a)), [musicPlatform])

  /** Share sheet when available, else copy the link. A dismissed sheet is not an error. */
  const share = useCallback(
    async (a: CardArtist) => {
      const url = getShareableArtistLink(musicPlatform, linkRef(a))
      if (navigator.share) {
        try {
          const why = whyText(a.why)
          await navigator.share({ title: `${a.name} on flipside`, text: why ? `${why}. Have a listen:` : undefined, url })
          return
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return
          // Share refused (e.g. not allowed here): fall through to copying.
        }
      }
      try {
        await navigator.clipboard.writeText(url)
        notify(`Link to ${a.name} copied`)
      } catch {
        toast.error("Couldn't copy link")
      }
    },
    [musicPlatform, notify],
  )

  /** Select the neighbour in the visible queue (clamped); returns the new selection. */
  const move = useCallback(
    (dir: 1 | -1) => {
      const id = step(ids, signals, selectedId, dir)
      if (id) setSelectedId(id)
      return id
    },
    [ids, signals, selectedId],
  )

  /** Snap: the artist scrolled into view becomes the selection, decided or not. */
  // Playback hand-over to that artist is issue #192.
  const becomeCurrent = useCallback((id: string) => setSelectedId(id), [])

  const visible = useMemo(
    () => visibleQueue(ids, signals).map((id) => byId.get(id)!),
    [ids, signals, byId],
  )

  const tuningValue = useMemo(() => tuning(artists, signals), [artists, signals])

  return {
    /** Every loaded artist id, in feed order (the progress strip). */
    ids,
    /** Every loaded artist by id. */
    byId,
    signals,
    setSignal,
    savedIds,
    toggleSave,
    selectedId,
    selected: selectedId ? byId.get(selectedId) ?? null : null,
    select: setSelectedId,
    becomeCurrent,
    move,
    visible,
    remaining: remaining(ids, signals),
    total: ids.length,
    counts: counts(ids, signals),
    /** Genres liked artists lean toward (≤6) and passed ones away from (≤4). */
    tuning: tuningValue,
    nowPlayingArtist,
    isPlaying,
    togglePlay,
    playTrack,
    tracksOf,
    addTracks,
    judge,
    lastPlan,
    undoLast,
    save,
    musicPlatform,
    artistLink,
    share,
  }
}

export type FeedTriage = ReturnType<typeof useFeedTriage>

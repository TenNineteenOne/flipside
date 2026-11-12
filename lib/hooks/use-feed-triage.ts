"use client"

import { createElement, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Undo2 } from "lucide-react"
import { useAudio } from "@/lib/audio-context"
import { artworkFor } from "@/lib/feed/artwork"
import { decide, type Plan } from "@/lib/feed/decision"
import { counts, firstUndecided, reconcileSelection, remaining, step, visibleQueue, type Signal } from "@/lib/feed/triage-queue"
import { tuning } from "@/lib/feed/tuning"

const END_PAGE = "__end"
import { shouldHandOver } from "@/lib/feed/hand-over"
import { activationStamp, isDoubleActivation } from "@/lib/feed/double-activation"
import { isCurrentTrack as isCurrent, nowPlayingArtistId } from "@/lib/feed/now-playing"
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
 * (desktop, tablet and Snap) reads the same object.
 */
const TOAST_MS = 5000
/** Keep in step with the top-right toast offsets in components/feed/feed.css. */
const SHORT = "(height < 480px)"

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
  const { signals, setSignal, restore } = useArtistFeedback({
    errorMessages: {
      undoFailed: "Couldn't undo. Try again.",
      saveFailed: "Couldn't save feedback. Try again.",
    },
  })
  const { savedIds, toggleSave } = useArtistSaves()

  const ids = useMemo(() => artists.map((a) => a.id), [artists])
  const byId = useMemo(() => new Map(artists.map((a) => [a.id, a])), [artists])
  const [chosenId, setSelectedId] = useState<string | null>(() => firstUndecided(ids, signals))
  // Derived, not synced: appends keep the selection; at the end of the queue (null)
  // the first newly arrived undecided artist is selected.
  // END_PAGE: the phone end page is in view; it holds even while artists are unrated (no snap back).
  const selectedId = chosenId === END_PAGE ? null : reconcileSelection(ids, signals, chosenId)
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
  // The artist this hook last started a track for (shared track ids: see nowPlayingArtistId).
  const [started, setStarted] = useState<{ trackId: string; artistId: string } | null>(null)
  /** The artist whose track is loaded in the player (playing or paused), or null. */
  const nowPlayingArtist = useMemo(() => {
    const id = nowPlayingArtistId(current?.id ?? null, started, artists.map((a) => ({ id: a.id, tracks: tracksOf(a) })))
    return id ? byId.get(id) ?? null : null
  }, [current, started, artists, tracksOf, byId])
  const owns = useCallback((a: CardArtist) => nowPlayingArtist?.id === a.id, [nowPlayingArtist])
  /** The loaded track on this artist's card (progress ring, current chip / row); by artist, as tracks can be shared. */
  const isCurrentTrack = useCallback(
    (a: CardArtist, t: Track) => isCurrent(nowPlayingArtist?.id ?? null, current?.id ?? null, a.id, t.id),
    [nowPlayingArtist, current],
  )
  const playingArtistId = audio.isPlaying ? nowPlayingArtist?.id ?? null : null
  const isPlaying = useCallback((a: CardArtist) => a.id === playingArtistId, [playingArtistId])

  const { play, pause, resume } = audio
  const playArtist = useCallback(
    (a: CardArtist, index = 0) => {
      const playable = tracksOf(a).filter((t) => t.previewUrl)
      const t = playable[index]
      if (t) {
        setStarted({ trackId: t.id, artistId: a.id })
        play(t, a.name, artworkFor(a), resolveArtistColor(a.artistColor, a.name))
      } else pause()
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

  /** Play track `index` of the artist's playable tracks; the playing one toggles pause/resume; a missing one does nothing. */
  const playTrack = useCallback(
    (a: CardArtist, index: number) => {
      const t = tracksOf(a).filter((x) => x.previewUrl)[index]
      if (!t) return // no such track (e.g. "3" on a one-preview artist): leave playback alone
      if (current?.id !== t.id || !owns(a)) playArtist(a, index)
      else if (audio.isPlaying) pause()
      else resume()
    },
    [tracksOf, current, owns, playArtist, audio.isPlaying, pause, resume],
  )

  // One toast at a time: each gets a fresh id and the previous one is dismissed.
  // (A reused id merged a new toast into one that was being dismissed, so it
  // vanished with no working undo, and hovering an old toast paused the next.)
  // The undo stays available exactly as long as its toast is up.
  const undoRef = useRef<{ undo: Undo; token: object } | null>(null)
  const toastId = useRef<string | null>(null)
  const toastSeq = useRef(0)
  const dismissToast = useCallback(() => {
    if (toastId.current !== null) toast.dismiss(toastId.current)
    toastId.current = null
  }, [])

  // Leaving the feed: its toast and its undo go with it.
  useEffect(
    () => () => {
      undoRef.current = null
      dismissToast()
    },
    [dismissToast],
  )

  /** Undo the most recent decision while its toast is showing, then reselect that artist. No-op otherwise. */
  const undoLast = useCallback(() => {
    const u = undoRef.current?.undo
    if (!u) return
    undoRef.current = null
    dismissToast()
    void restore(u.artistId, u.restore)
    setSelectedId(u.artistId)
  }, [restore, dismissToast])

  const notify = useCallback(
    (message: string, undo: Undo | null = null) => {
      const token = {}
      undoRef.current = undo ? { undo, token } : null
      const expire = () => { if (undoRef.current?.token === token) undoRef.current = null }
      dismissToast()
      const id = `feed-triage-${++toastSeq.current}`
      toastId.current = id
      toast(message, {
        id,
        duration: TOAST_MS,
        unstyled: true,
        // Short viewports (phones in landscape: the Snap feed) have no room above the triage bar:
        // the toast goes to the top right of the feed area instead (feed.css sets the offsets).
        position: matchMedia(SHORT).matches ? "top-right" : "bottom-left",
        classNames: { toast: "ev-toast", title: "ev-toast-text", actionButton: "ev-toast-undo" },
        // A dying older toast's Undo must not undo the newer decision.
        action: undo ? { label: UNDO_LABEL, onClick: () => { if (undoRef.current?.token === token) undoLast() } } : undefined,
        onAutoClose: expire,
        onDismiss: expire,
      })
      return id
    },
    [undoLast, dismissToast],
  )

  const lastAdvance = useRef<{ artistId: string; at: number } | null>(null)

  /** Returns null when the artist is unknown or the call is a double activation (ignored). */
  const judge = useCallback(
    (artistId: string, signal: Signal, opts: JudgeOptions): Plan | null => {
      const a = byId.get(artistId)
      if (!a) return null
      const now = performance.now()
      if (isDoubleActivation(lastAdvance.current, artistId, opts.advance, now)) return null
      const plan = decide({ ids, signals, selectedId, playingArtistId }, { artistId, name: a.name, signal, ...opts })
      if (opts.advance) lastAdvance.current = activationStamp(lastAdvance.current, artistId, selectedId, plan.selectId, now)
      const sent = plan.send.kind === "set" ? setSignal(artistId, plan.send.signal) : null
      setSelectedId(plan.selectId)
      if (plan.audio.kind === "play") {
        const next = byId.get(plan.audio.artistId)
        if (next) playArtist(next)
      } else if (plan.audio.kind === "pause") pause()
      setLastPlan(plan)
      const shown = plan.message ? notify(plan.message, plan.undo) : null
      // The request failed and the verdict rolled back (useArtistFeedback toasts the error): this
      // decision's "… Undo" toast would describe something that did not happen, so it goes, with its undo.
      void sent?.then((ok) => {
        if (ok || !shown || toastId.current !== shown) return
        undoRef.current = null
        dismissToast()
      })
      return plan
    },
    [byId, ids, signals, selectedId, playingArtistId, setSignal, playArtist, pause, notify, dismissToast],
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
          // Just the link: the messaging app's preview card names the artist; the sender adds their own words.
          await navigator.share({ url })
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

  /**
   * Snap: the artist scrolled into view becomes the selection, decided or not
   * (null: the end page). If another artist's track is playing, this artist's
   * first track takes over; paused or silent audio is left alone.
   */
  const becomeCurrent = useCallback(
    (id: string | null) => {
      setSelectedId(id ?? END_PAGE)
      const a = id ? byId.get(id) : undefined
      if (a && shouldHandOver(a.id, audio.isPlaying, nowPlayingArtist?.id ?? null)) playArtist(a)
    },
    [byId, audio.isPlaying, nowPlayingArtist, playArtist],
  )

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
    isCurrentTrack,
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

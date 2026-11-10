/**
 * Decision core of the feed triage hook (PRD #182, Modules 6; issue #186):
 * what to do when the listener judges an artist, as a pure plan the hook executes.
 */
import { nextUndecided, type Signal, type Signals } from "./triage-queue"

export interface DecisionState {
  ids: readonly string[]
  signals: Signals
  selectedId: string | null
  /** Artist whose track is currently playing, or null when nothing is playing. */
  playingArtistId: string | null
}

export interface DecisionRequest {
  artistId: string
  /**
   * Display name for the toast. Passed directly rather than via a lookup:
   * the caller always has the artist object in hand when it judges.
   */
  name: string
  signal: Signal
  /** true for buttons/keys (repeat "more" un-likes); false for a swipe (repeat is a no-op). */
  toggle: boolean
  /** Move the selection on when the judged artist is the selected one. */
  advance: boolean
}

export type Plan = {
  /** What to send through the feedback hook. */
  send: { kind: "set"; signal: Signal } | { kind: "none" }
  /** New selected artist id, or the unchanged one. */
  selectId: string | null
  /** Start this artist's first track, pause, or leave audio alone. */
  audio: { kind: "play"; artistId: string } | { kind: "pause" } | { kind: "none" }
  /** The verdict to restore on Undo (undefined = undecided), or null when nothing was sent. */
  undo: { artistId: string; restore: Signal | undefined } | null
  /** Toast text. */
  message: string
}

const MESSAGE = { thumbs_up: "More like", thumbs_down: "Less like", skip: "Dismissed" } as const

const asSignal = (s: string | undefined): Signal | undefined =>
  s === "thumbs_up" || s === "thumbs_down" || s === "skip" ? s : undefined

export function decide(state: DecisionState, req: DecisionRequest): Plan {
  const { artistId, name, signal } = req
  const unchanged = { selectId: state.selectedId, audio: { kind: "none" } as const, undo: null }

  if (signal === "thumbs_up" && state.signals.get(artistId) === "thumbs_up") {
    return req.toggle
      ? { ...unchanged, send: { kind: "set", signal }, message: `Removed like from ${name}` }
      : { ...unchanged, send: { kind: "none" }, message: "" }
  }

  const advanced = req.advance && artistId === state.selectedId
  const after = new Map(state.signals).set(artistId, signal)
  const selectId = advanced ? nextUndecided(state.ids, after, artistId) : state.selectedId
  const audio: Plan["audio"] =
    advanced && state.playingArtistId === artistId
      ? selectId ? { kind: "play", artistId: selectId } : { kind: "pause" }
      : { kind: "none" }

  return {
    send: { kind: "set", signal },
    selectId,
    audio,
    undo: { artistId, restore: asSignal(state.signals.get(artistId)) },
    message: `${MESSAGE[signal]} ${name}`,
  }
}

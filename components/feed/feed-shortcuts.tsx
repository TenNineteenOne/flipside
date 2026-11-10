"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { X } from "lucide-react"
import { useShellShortcuts } from "@/components/shell/shell-context"
import { feedAction } from "@/lib/feed/feed-keymap"
import { PLATFORM_META } from "@/lib/music-links"
import type { FeedTriage } from "@/lib/hooks/use-feed-triage"

/** Small keycap hint; feed.css hides it on touch and below 900px (except in the sheet). */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ev-kbd">{children}</kbd>
}

const EDITABLE = "input, textarea, select, [contenteditable]"
/** Open menus, dialogs and popups own their keys (the shell's avatar menu: arrows, letters). */
const POPUP = '[role="menu"], [role="dialog"], dialog[open]'

/**
 * Feed keyboard control (PRD #182, keyboard stories): one window `keydown`
 * listener while the feed is mounted, mapped by the pure `feedAction`, and the
 * "?" shortcut sheet (native dialog), also opened from the rail's Shortcuts item.
 */
export function FeedShortcuts({ triage, enabled = true }: {
  triage: FeedTriage
  /** false while the layout on screen is not mounted yet (its chunk loading): every key is ignored. */
  enabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openSheet = useCallback(() => setOpen(true), [])
  useShellShortcuts(openSheet)

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close() // close() returns focus to where it was before showModal()
  }, [open])

  // The listener is added once; it always runs the latest handler.
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    handlerRef.current = (e: KeyboardEvent) => {
      if (!enabled) return
      const el = e.target instanceof Element ? e.target : document.body
      const action = feedAction({
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        targetIsEditable: !!el.closest(EDITABLE),
        targetIsButtonOrLink: el.tagName === "BUTTON" || el.tagName === "A",
        // The shortcut sheet is a dialog too; its own keys ("?" closes it) stay handled here.
        targetInPopup: !!el.closest(POPUP) && !dialogRef.current?.contains(el),
        defaultPrevented: e.defaultPrevented,
        helpOpen: open,
        repeat: e.repeat,
      })
      if (!action) return
      if (action === "next" || action === "prev" || action === "togglePlay" || action === "toggleHelp") e.preventDefault()
      if (action === "toggleHelp") return setOpen((o) => !o)
      if (action === "undo") return triage.undoLast()
      if (action === "next" || action === "prev") {
        const id = triage.move(action === "next" ? 1 : -1)
        if (id) document.getElementById(`ev-row-${id}`)?.scrollIntoView({ block: "nearest" })
        return
      }
      const a = triage.selected
      if (!a) return
      switch (action) {
        case "togglePlay": return triage.togglePlay(a)
        case "track1": case "track2": case "track3": return triage.playTrack(a, Number(action.slice(-1)) - 1)
        case "more": return void triage.judge(a.id, "thumbs_up", { toggle: true, advance: true })
        case "less": return void triage.judge(a.id, "thumbs_down", { toggle: true, advance: true })
        case "dismiss": return void triage.judge(a.id, "skip", { toggle: true, advance: true })
        case "save": return triage.save(a)
        case "open": return void window.open(triage.artistLink(a), "_blank", "noopener")
        case "share": return void triage.share(a)
      }
    }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handlerRef.current(e)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const rows: [string[], string][] = [
    [["J", "↓"], "Next artist"],
    [["K", "↑"], "Previous artist"],
    [["Space"], "Play / pause"],
    [["1", "2", "3"], "Play track 1–3"],
    [["L"], "More like this"],
    [["X"], "Less like this"],
    [["D"], "Dismiss"],
    [["B"], "Save for later"],
    [["O"], `Open in ${PLATFORM_META[triage.musicPlatform].label}`],
    [["S"], "Share"],
    [["Z"], "Undo"],
    [["?"], "This list"],
  ]

  return (
    <dialog
      ref={dialogRef}
      className="ev-feed ev-sheet"
      aria-labelledby="ev-sheet-title"
      onClose={() => setOpen(false)}
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div className="ev-sheet-inner">
        <header className="ev-sheet-head">
          <h2 id="ev-sheet-title">Keyboard shortcuts</h2>
          <button type="button" className="ev-icon-btn" onClick={() => setOpen(false)} aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </header>
        <dl className="ev-sheet-list">
          {rows.map(([keys, label]) => (
            <div key={label} className="ev-sheet-row">
              <dt>{label}</dt>
              <dd>{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</dd>
            </div>
          ))}
        </dl>
        <p className="ev-sheet-note">Triage moves you to the next artist. If music is playing, it keeps playing.</p>
      </div>
    </dialog>
  )
}

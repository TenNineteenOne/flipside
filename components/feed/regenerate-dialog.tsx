"use client"

import "./feed.css"
import { useEffect, useRef, useState } from "react"

/** localStorage key: the local date (YYYY-MM-DD) on which "Don't ask again today" was ticked. */
export const REGEN_SKIP_KEY = "flipside.regen-skip"

/** Today's date in the viewer's own timezone, so "today" ends at their midnight. */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Ask first only when unrated cards would be lost and the viewer hasn't opted out today. */
export function shouldConfirm(remaining: number, skippedOn: string | null, today: string): boolean {
  return remaining > 0 && skippedOn !== today
}

export function readRegenSkip(): string | null {
  try {
    return localStorage.getItem(REGEN_SKIP_KEY)
  } catch {
    return null
  }
}

export function writeRegenSkip(day: string): void {
  try {
    localStorage.setItem(REGEN_SKIP_KEY, day)
  } catch {
    // private mode: the dialog just asks again next time
  }
}

/**
 * "Regenerate your feed?" (native modal dialog, styled like the shortcut sheet). Esc, the backdrop
 * and Cancel close it without regenerating; Yes reports whether "Don't ask again today" was ticked.
 */
export function RegenerateDialog({ open, remaining, onCancel, onConfirm }: {
  open: boolean
  remaining: number
  onCancel: () => void
  onConfirm: (skipToday: boolean) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [skip, setSkip] = useState(false)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      setSkip(false) // eslint-disable-line react-hooks/set-state-in-effect -- reset per opening
      d.showModal()
    }
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="ev-feed ev-sheet ev-regen-dialog"
      aria-labelledby="ev-regen-title"
      aria-describedby="ev-regen-body"
      onClose={onCancel}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="ev-sheet-inner">
        <h2 id="ev-regen-title" className="ev-regen-title">Regenerate your feed?</h2>
        <p id="ev-regen-body" className="ev-regen-body">
          Your {remaining} unrated {remaining === 1 ? "artist" : "artists"} will be replaced.
        </p>
        <label className="ev-regen-skip">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          Don&rsquo;t ask again today
        </label>
        <div className="ev-regen-actions">
          {/* Cancel takes focus, so a stray Enter or Space never wipes the feed. */}
          <button type="button" className="ev-btn ev-btn-ghost" onClick={onCancel} autoFocus>Cancel</button>
          <button type="button" className="ev-btn ev-regen" onClick={() => onConfirm(skip)}>Yes, regenerate</button>
        </div>
      </div>
    </dialog>
  )
}

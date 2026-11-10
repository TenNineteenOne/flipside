import { useCallback, useState } from "react"

export interface Shown<T> {
  item: T
  key: string
  leaving: boolean
}

/**
 * The next list to render: `items` in order, plus items that just left `items`, kept at their
 * old place and marked `leaving` (when `keep`) until `done` removes them. Retained items keep
 * their relative order in both lists (a feed queue: removals, re-inserts, appends). Pure.
 */
export function mergeLeaving<T>(shown: Shown<T>[], items: T[], keyOf: (t: T) => string, keep: boolean): Shown<T>[] {
  const next = new Map(items.map((t) => [keyOf(t), t]))
  const placed = new Set<string>()
  const out: Shown<T>[] = []
  let j = 0
  for (const s of shown) {
    const fresh = next.get(s.key)
    if (fresh === undefined) {
      if (keep) out.push(s.leaving ? s : { ...s, leaving: true })
      continue
    }
    // New items that come before this retained one.
    while (j < items.length && keyOf(items[j]) !== s.key) {
      const k = keyOf(items[j])
      if (!shown.some((x) => x.key === k)) { out.push({ item: items[j], key: k, leaving: false }); placed.add(k) }
      j++
    }
    out.push({ item: fresh, key: s.key, leaving: false })
    placed.add(s.key)
    j++
  }
  for (const t of items) {
    const k = keyOf(t)
    if (!placed.has(k)) out.push({ item: t, key: k, leaving: false })
  }
  return out
}

/**
 * Keeps removed items rendered while their exit animation plays (a CSS stand-in for
 * framer-motion's AnimatePresence). Call `done(key)` when an item's animation ends.
 * With `animate` false (reduced motion) removed items go at once.
 */
export function useLeaving<T>(items: T[], keyOf: (t: T) => string, animate: boolean) {
  const [state, setState] = useState(() => ({ items, shown: mergeLeaving<T>([], items, keyOf, false) }))
  let shown = state.shown
  if (state.items !== items) {
    shown = mergeLeaving(state.shown, items, keyOf, animate)
    setState({ items, shown })
  }
  const done = useCallback(
    (key: string) => setState((s) => ({ ...s, shown: s.shown.filter((x) => !(x.leaving && x.key === key)) })),
    [],
  )
  return { shown, done }
}

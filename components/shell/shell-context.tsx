"use client"

import { createContext, useContext, useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"

/**
 * Lets a page put its own content into the shell without the shell knowing
 * about it: a count badge on a nav item, a Shortcuts handler, and two slots
 * (the phone top bar, and the rail under the nav).
 */
export type ShellSlotName = "top" | "rail"

export interface ShellApi {
  slots: Record<ShellSlotName, HTMLElement | null>
  setBadge: (href: string, count: number | undefined) => void
  setShortcuts: (open: (() => void) | undefined) => void
}

export const ShellContext = createContext<ShellApi | null>(null)

/** Show `count` as a badge on the nav item for `href` while mounted (0 or undefined hides it). */
export function useShellBadge(href: string, count: number | undefined) {
  const shell = useContext(ShellContext)
  useEffect(() => {
    shell?.setBadge(href, count)
    return () => shell?.setBadge(href, undefined)
  }, [shell, href, count])
}

/** Show the rail's "Shortcuts" button while mounted; pressing it calls `open`. */
export function useShellShortcuts(open: (() => void) | undefined) {
  const shell = useContext(ShellContext)
  useEffect(() => {
    shell?.setShortcuts(open)
    return () => shell?.setShortcuts(undefined)
  }, [shell, open])
}

/** Render children into a shell slot: "top" (phone/tablet top bar) or "rail" (desktop rail, under the nav). */
export function ShellSlot({ name, children }: { name: ShellSlotName; children: ReactNode }) {
  const el = useContext(ShellContext)?.slots[name]
  return el ? createPortal(children, el) : null
}

"use client"

import "./shell.css"
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { BarChart3, Bookmark, Clock, Compass, Keyboard, LogOut, Music2, Settings } from "lucide-react"
import { IdenticonAvatar } from "@/components/ui/identicon-avatar"
import { NavLinkStatus } from "@/components/nav/navigation-progress"
import { useAdventurousMode } from "@/lib/hooks/use-adventurous-mode"
import { ShellContext, type ShellApi } from "./shell-context"
import { Wordmark } from "./wordmark"

export const NAV = [
  { href: "/feed", label: "Feed", icon: Music2 },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/history", label: "History", icon: Clock },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/stats", label: "Stats", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const

/** The phone/tablet tab bar: everything but Settings, which lives in the avatar menu. */
const TABS = NAV.filter((n) => n.href !== "/settings")

export const isCurrent = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(href + "/")

interface AppShellProps {
  userSeed: string
  initialAdventurous: boolean
  /** Dev preview only: strip this prefix before matching the current section (/dev-preview/feed → Feed). */
  pathPrefix?: string
  children: ReactNode
}

/**
 * Signed-in app shell. ≥900px: a fixed navigation rail. Below 900px: a slim
 * top bar (wordmark + avatar menu) and a bottom tab bar. Which one shows is
 * pure CSS, so the server render is the same at every width.
 */
export function AppShell({ userSeed, initialAdventurous, pathPrefix, children }: AppShellProps) {
  const rawPath = usePathname()
  const pathname = pathPrefix && rawPath.startsWith(pathPrefix) ? rawPath.slice(pathPrefix.length) : rawPath
  const { adventurous } = useAdventurousMode(initialAdventurous)
  const menuRef = useRef<HTMLDivElement>(null)

  const [badges, setBadges] = useState<Record<string, number | undefined>>({})
  const [shortcuts, setShortcutsState] = useState<(() => void) | undefined>(undefined)
  const [topSlot, setTopSlot] = useState<HTMLElement | null>(null)
  const [topSubSlot, setTopSubSlot] = useState<HTMLElement | null>(null)
  const [railSlot, setRailSlot] = useState<HTMLElement | null>(null)

  const setBadge = useCallback(
    (href: string, count: number | undefined) =>
      setBadges((prev) => (prev[href] === count ? prev : { ...prev, [href]: count })),
    [],
  )
  // Wrapped: a bare function passed to setState would be called as an updater.
  const setShortcuts = useCallback((open: (() => void) | undefined) => setShortcutsState(() => open), [])

  const api = useMemo<ShellApi>(
    () => ({ slots: { top: topSlot, topSub: topSubSlot, rail: railSlot }, setBadge, setShortcuts }),
    [topSlot, topSubSlot, railSlot, setBadge, setShortcuts],
  )

  const closeMenu = () => menuRef.current?.hidePopover()

  return (
    <ShellContext.Provider value={api}>
      <div className={`shell${adventurous ? " adventurous" : ""}`}>
        <div className="shell-rail">
          <Link href="/feed" className="shell-rail-brand" aria-label="flipside, go to Feed" title="flipside">
            <Wordmark />
          </Link>
          <nav className="shell-nav" aria-label="Main">
            {NAV.map(({ href, label, icon: Icon }) => {
              const count = badges[href]
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch={href === "/explore" ? true : undefined}
                  className="shell-nav-item"
                  aria-current={isCurrent(pathname, href) ? "page" : undefined}
                  aria-label={count ? `${label}, ${count}` : label}
                  title={label}
                >
                  <Icon size={18} strokeWidth={1.75} aria-hidden />
                  <span className="shell-nav-label">{label}</span>
                  {!!count && <span className="shell-nav-count" aria-hidden>{count}</span>}
                  <NavLinkStatus />
                </Link>
              )
            })}
          </nav>
          <div className="shell-rail-slot" ref={setRailSlot} />
          <div className="shell-rail-foot">
            {shortcuts && (
              <button type="button" className="shell-rail-keys" onClick={shortcuts} title="Shortcuts" aria-label="Keyboard shortcuts">
                <Keyboard size={16} strokeWidth={1.75} aria-hidden />
                <span className="shell-nav-label">Shortcuts</span>
                <kbd className="shell-kbd">?</kbd>
              </button>
            )}
            <span className="shell-user">
              <IdenticonAvatar seed={userSeed} size={26} />
            </span>
          </div>
        </div>

        <header className="shell-top">
          <div className="shell-top-row">
            <Link href="/feed" className="shell-top-brand" aria-label="flipside, go to Feed">
              <Wordmark />
            </Link>
            <div className="shell-top-slot" ref={setTopSlot} />
            <button
              type="button"
              className="shell-avatar"
              popoverTarget="shell-menu"
              aria-label="Account and settings"
            >
              <IdenticonAvatar seed={userSeed} size={30} />
            </button>
          </div>
          {/* Optional second row (empty → hidden): the phone feed's progress strip. */}
          <div className="shell-top-sub" ref={setTopSubSlot} />
        </header>
        <div id="shell-menu" ref={menuRef} popover="auto" className="shell-menu">
          <Link
            href="/settings"
            className="shell-menu-item"
            aria-current={isCurrent(pathname, "/settings") ? "page" : undefined}
            onClick={closeMenu}
          >
            <Settings size={18} strokeWidth={1.75} aria-hidden />
            Settings
            <NavLinkStatus />
          </Link>
          <button type="button" className="shell-menu-item" onClick={() => signOut({ callbackUrl: "/" })}>
            <LogOut size={18} strokeWidth={1.75} aria-hidden />
            Sign out
          </button>
        </div>

        <main className="shell-main">{children}</main>

        <nav className="shell-tabs" aria-label="Main">
          {TABS.map(({ href, label, icon: Icon }) => {
            const count = badges[href]
            return (
              <Link
                key={href}
                href={href}
                prefetch={href === "/explore" ? true : undefined}
                className="shell-tab"
                aria-current={isCurrent(pathname, href) ? "page" : undefined}
                aria-label={count ? `${label}, ${count}` : undefined}
              >
                <Icon size={22} strokeWidth={1.75} aria-hidden />
                <span>{label}</span>
                {!!count && <span className="shell-tab-dot" aria-hidden>{count}</span>}
                <NavLinkStatus />
              </Link>
            )
          })}
        </nav>
      </div>
    </ShellContext.Provider>
  )
}

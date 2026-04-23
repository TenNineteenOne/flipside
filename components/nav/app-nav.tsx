"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Music2, Bookmark, Settings, Clock, BarChart3, Compass } from "lucide-react"
import { IdenticonAvatar } from "@/components/ui/identicon-avatar"
import { NavLinkStatus } from "@/components/nav/navigation-progress"

const navLinks = [
  { href: "/feed",     label: "Feed",     icon: Music2,    color: "var(--accent)" },
  { href: "/explore",  label: "Explore",  icon: Compass,   color: "#f5b047" },
  { href: "/history",  label: "History",  icon: Clock,     color: "#7dd9c6" },
  { href: "/saved",    label: "Saved",    icon: Bookmark,  color: "#ec6fb5" },
  { href: "/stats",    label: "Stats",    icon: BarChart3, color: "#a8c7fa" },
  { href: "/settings", label: "Settings", icon: Settings,  color: "#ff9e7a" },
]

interface AppNavProps {
  userSeed?: string
  initialAdventurous?: boolean
}

export function AppNav({ userSeed = "user", initialAdventurous = false }: AppNavProps) {
  const pathname = usePathname()
  const [adventurous, setAdventurous] = useState(initialAdventurous)

  useEffect(() => {
    const read = () => {
      try {
        setAdventurous(localStorage.getItem("flipside.adventurous") === "1")
      } catch {
        // noop — private mode or blocked storage
      }
    }
    read()
    window.addEventListener("flipside:adventurous-change", read)
    window.addEventListener("storage", read)
    return () => {
      window.removeEventListener("flipside:adventurous-change", read)
      window.removeEventListener("storage", read)
    }
  }, [])

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/")

  const tabbarClass = `tabbar${adventurous ? " adventurous" : ""}`

  return (
    <>
      {/* ── Desktop top nav (≥ 900px) ── */}
      <header className="topnav">
        {/* Brand mark */}
        <span className="topnav-brand">
          <span className="dot" />
          <span>flipside</span>
        </span>

        {/* Nav links */}
        <nav className="topnav-links">
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              prefetch={href === "/explore" ? true : undefined}
              className={isActive(href) ? "active" : ""}
            >
              {label}
              <NavLinkStatus />
            </Link>
          ))}
        </nav>

        {/* Avatar */}
        <IdenticonAvatar seed={userSeed} size={32} />
      </header>

      {/* ── Mobile bottom tab bar (< 900px) ── */}
      <nav className={tabbarClass}>
        {navLinks.map(({ href, label, icon: Icon, color }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              prefetch={href === "/explore" ? true : undefined}
              className={active ? "active" : ""}
            >
              <Icon size={22} style={{ color }} />
              <span>{label}</span>
              <NavLinkStatus />
            </Link>
          )
        })}
      </nav>
    </>
  )
}

"use client"

import { useEffect, useState, type CSSProperties } from "react"
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

  return (
    <header className={`appnav${adventurous ? " adventurous" : ""}`}>
      <div className="appnav-inner">
        <span className="appnav-brand">
          <span className="dot" />
          <span className="wordmark">flipside</span>
        </span>

        <nav className="appnav-tabs">
          {navLinks.map(({ href, label, icon: Icon, color }) => {
            const active = isActive(href)
            const styleVars = { "--tab-color": color } as CSSProperties
            return (
              <Link
                key={href}
                href={href}
                prefetch={href === "/explore" ? true : undefined}
                aria-current={active ? "page" : undefined}
                className={active ? "active" : ""}
                style={styleVars}
              >
                <Icon size={22} style={{ color }} />
                <span>{label}</span>
                <NavLinkStatus />
              </Link>
            )
          })}
        </nav>

        <span className="appnav-avatar">
          <IdenticonAvatar seed={userSeed} size={32} />
        </span>
      </div>
    </header>
  )
}

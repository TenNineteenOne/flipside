"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Music2, Bookmark, Settings, Clock, BarChart3, Compass } from "lucide-react"
import { IdenticonAvatar } from "@/components/ui/identicon-avatar"

const navLinks = [
  { href: "/feed",     label: "Feed",     icon: Music2    },
  { href: "/explore",  label: "Explore",  icon: Compass   },
  { href: "/history",  label: "History",  icon: Clock     },
  { href: "/saved",    label: "Saved",    icon: Bookmark  },
  { href: "/stats",    label: "Stats",    icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings  },
]

interface AppNavProps {
  userSeed?: string
}

export function AppNav({ userSeed = "user" }: AppNavProps) {
  const pathname = usePathname()
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/")

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
              className={isActive(href) ? "active" : ""}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Avatar */}
        <IdenticonAvatar seed={userSeed} size={32} />
      </header>

      {/* ── Mobile bottom tab bar (< 900px) ── */}
      <nav className="tabbar">
        {navLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={isActive(href) ? "active" : ""}
          >
            <Icon size={22} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  )
}

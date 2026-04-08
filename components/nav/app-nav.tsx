"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Music2, Bookmark, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

const navLinks = [
  { href: "/feed",     label: "Feed",     icon: Music2    },
  { href: "/saved",    label: "Saved",    icon: Bookmark  },
  { href: "/settings", label: "Settings", icon: Settings  },
]

interface AppNavProps {
  userName?: string
  userImage?: string | null
}

export function AppNav({ userName = "User", userImage = null }: AppNavProps) {
  const pathname = usePathname()

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/")

  /* ── shared inline style objects ── */
  const navBg: React.CSSProperties = {
    background: "rgba(8,8,8,0.92)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
  }

  const avatar =
    userImage ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={userImage}
        alt={userName}
        className="size-8 rounded-full object-cover"
        style={{ border: "1px solid var(--accent-border)" }}
      />
    ) : (
      <div
        className="flex size-8 items-center justify-center rounded-full text-xs font-semibold"
        style={{
          background: "var(--accent-subtle)",
          border: "1px solid var(--accent-border)",
          color: "var(--accent)",
        }}
      >
        {userName.charAt(0).toUpperCase()}
      </div>
    )

  return (
    <>
      {/* ── Desktop top nav (≥ 768px) ── */}
      <header
        className="sticky top-0 z-50 hidden h-14 w-full md:flex items-center"
        style={{
          ...navBg,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="flex w-full items-center justify-between px-6">
          {/* Logo */}
          <span
            className="select-none text-lg"
            style={{ fontWeight: 700, color: "#ffffff", fontFamily: "Inter, var(--font-sans), sans-serif" }}
          >
            flipside
          </span>

          {/* Nav links */}
          <nav className="flex items-center gap-6">
            {navLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-sm font-medium transition-colors"
                style={{ color: isActive(href) ? "var(--accent)" : "var(--text-muted)" }}
              >
                {label}
              </Link>
            ))}
          </nav>

          {/* Avatar */}
          {avatar}
        </div>
      </header>

      {/* ── Mobile bottom tab bar (< 768px) ── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex h-16 items-stretch md:hidden"
        style={{
          ...navBg,
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {navLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors"
            )}
            style={{ color: isActive(href) ? "var(--accent)" : "#444444" }}
          >
            <Icon className="size-5" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  )
}

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Music2, Bookmark, LogOut } from "lucide-react"
import { cn } from "@/lib/utils"

const navLinks = [
  { href: "/feed", label: "Feed", icon: Music2 },
  { href: "/saved", label: "Saved", icon: Bookmark },
]

interface AppNavProps {
  userName?: string
  userImage?: string | null
}

export function AppNav({ userName = "User", userImage = null }: AppNavProps) {
  const pathname = usePathname()

  return (
    <>
      {/* Desktop top nav */}
      <header className="sticky top-0 z-50 hidden h-14 w-full items-center border-b border-border bg-background/95 backdrop-blur md:flex">
        <div className="flex w-full items-center justify-between px-6">
          {/* Logo */}
          <span className="text-lg font-bold tracking-tight text-primary">
            flipside
          </span>

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            {navLinks.map(({ href, label }) => {
              const isActive = pathname === href || pathname.startsWith(href + "/")
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                  {isActive && (
                    <span className="absolute inset-x-3 -bottom-[1px] h-px rounded-full bg-primary" />
                  )}
                </Link>
              )
            })}
          </nav>

          {/* Right side: avatar + sign out */}
          <div className="flex items-center gap-3">
            {/* Avatar */}
            {userImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={userImage}
                alt={userName}
                className="size-8 rounded-full object-cover ring-1 ring-primary/30"
              />
            ) : (
              <div className="flex size-8 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary ring-1 ring-primary/30">
                {userName.charAt(0).toUpperCase()}
              </div>
            )}

            {/* Sign out */}
            <Link
              href="/api/auth/signout"
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
              <span className="hidden lg:inline">Sign out</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile top bar (logo + avatar only, no nav links) */}
      <header className="sticky top-0 z-50 flex h-14 w-full items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:hidden">
        <span className="text-lg font-bold tracking-tight text-primary">
          flipside
        </span>
        {userImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={userImage}
            alt={userName}
            className="size-8 rounded-full object-cover ring-1 ring-primary/30"
          />
        ) : (
          <div className="flex size-8 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary ring-1 ring-primary/30">
            {userName.charAt(0).toUpperCase()}
          </div>
        )}
      </header>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 inset-x-0 z-50 flex h-16 items-stretch border-t border-border bg-background/95 backdrop-blur md:hidden">
        {navLinks.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + "/")
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-5" />
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}

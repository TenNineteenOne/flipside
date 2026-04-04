"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Check, Music, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Artist } from "@/lib/music-provider/types"

// ─── Types ──────────────────────────────────────────────────────────────────

type PageState = "loading" | "picker" | "submitting"

// ─── Artist card ─────────────────────────────────────────────────────────────

function ArtistCard({
  artist,
  selected,
  onToggle,
  disabled,
}: {
  artist: Artist
  selected: boolean
  onToggle: (artist: Artist) => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(artist)}
      disabled={disabled && !selected}
      className={[
        "group relative flex flex-col items-center gap-2 rounded-xl p-3 text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "bg-teal-500/10 ring-2 ring-teal-400"
          : "bg-card hover:bg-muted",
        disabled && !selected ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      {/* Image */}
      <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-muted">
        {artist.imageUrl ? (
          <Image
            src={artist.imageUrl}
            alt={artist.name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 40vw, 160px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Music className="size-8 text-muted-foreground" />
          </div>
        )}

        {/* Selected overlay */}
        {selected && (
          <div className="absolute inset-0 flex items-center justify-center bg-teal-500/30">
            <div className="rounded-full bg-teal-400 p-1">
              <Check className="size-4 text-background" strokeWidth={3} />
            </div>
          </div>
        )}
      </div>

      {/* Name */}
      <span className="w-full truncate text-center text-sm font-medium leading-tight text-foreground">
        {artist.name}
      </span>
    </button>
  )
}

// ─── Selected artist chip ─────────────────────────────────────────────────────

function SelectedChip({
  artist,
  onRemove,
}: {
  artist: Artist
  onRemove: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-teal-500/15 py-1 pl-1 pr-2 ring-1 ring-teal-400/40">
      <div className="relative size-6 shrink-0 overflow-hidden rounded-full bg-muted">
        {artist.imageUrl ? (
          <Image
            src={artist.imageUrl}
            alt={artist.name}
            fill
            className="object-cover"
            sizes="24px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Music className="size-3 text-muted-foreground" />
          </div>
        )}
      </div>
      <span className="max-w-[120px] truncate text-sm font-medium text-teal-300">
        {artist.name}
      </span>
      <button
        type="button"
        onClick={() => onRemove(artist.id)}
        className="rounded-full p-0.5 text-teal-400 hover:bg-teal-400/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={`Remove ${artist.name}`}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()

  const [pageState, setPageState] = useState<PageState>("loading")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Artist[]>([])
  const [selected, setSelected] = useState<Artist[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Check if onboarding is needed ──────────────────────────────────────────

  useEffect(() => {
    let cancelled = false

    async function checkOnboarding() {
      try {
        const res = await fetch("/api/onboarding/check")
        if (!res.ok) throw new Error("Failed to check onboarding status")
        const data: { needsOnboarding: boolean; topArtistCount: number } = await res.json()

        if (cancelled) return

        if (!data.needsOnboarding) {
          router.replace("/feed")
        } else {
          setPageState("picker")
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load onboarding. Please refresh.")
          setPageState("picker")
        }
      }
    }

    checkOnboarding()
    return () => { cancelled = true }
  }, [router])

  // ── Debounced search ───────────────────────────────────────────────────────

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!value.trim()) {
      setResults([])
      setSearching(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `/api/onboarding/search?q=${encodeURIComponent(value.trim())}`
        )
        if (!res.ok) throw new Error()
        const data: { artists: Artist[] } = await res.json()
        setResults(data.artists)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [])

  // ── Toggle selection ───────────────────────────────────────────────────────

  const toggleArtist = useCallback((artist: Artist) => {
    setSelected((prev) => {
      const exists = prev.some((a) => a.id === artist.id)
      if (exists) return prev.filter((a) => a.id !== artist.id)
      if (prev.length >= 5) return prev
      return [...prev, artist]
    })
  }, [])

  const removeArtist = useCallback((id: string) => {
    setSelected((prev) => prev.filter((a) => a.id !== id))
  }, [])

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleContinue() {
    if (selected.length < 3 || selected.length > 5) return
    setPageState("submitting")
    setError(null)

    try {
      const res = await fetch("/api/onboarding/seeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artistIds: selected.map((a) => a.id) }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? "Something went wrong")
      }

      router.replace("/feed")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save. Please try again.")
      setPageState("picker")
    }
  }

  // ── Render: loading ────────────────────────────────────────────────────────

  if (pageState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="size-8 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
          <p className="text-sm text-muted-foreground">Setting up your experience…</p>
        </div>
      </div>
    )
  }

  // ── Render: picker ─────────────────────────────────────────────────────────

  const canContinue = selected.length >= 3 && selected.length <= 5
  const atMax = selected.length >= 5

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-12">
      {/* Header */}
      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Pick your seed artists
        </h1>
        <p className="text-muted-foreground">
          Choose 3–5 artists you love. We&apos;ll use them to power your first
          recommendations.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive ring-1 ring-destructive/30">
          {error}
        </div>
      )}

      {/* Search input */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search for an artist…"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          className="h-11 pl-9 text-base"
        />
        {searching && (
          <div className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-teal-400 border-t-transparent" />
        )}
      </div>

      {/* Search results */}
      {results.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Results
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {results.map((artist) => {
              const isSelected = selected.some((a) => a.id === artist.id)
              return (
                <ArtistCard
                  key={artist.id}
                  artist={artist}
                  selected={isSelected}
                  onToggle={toggleArtist}
                  disabled={atMax}
                />
              )
            })}
          </div>
          {atMax && (
            <p className="mt-2 text-xs text-muted-foreground">
              Maximum 5 artists selected. Remove one to add another.
            </p>
          )}
        </section>
      )}

      {query.trim() && !searching && results.length === 0 && (
        <p className="mb-8 text-sm text-muted-foreground">
          No artists found for &ldquo;{query}&rdquo;.
        </p>
      )}

      {/* Selected artists */}
      {selected.length > 0 && (
        <section className="mt-auto">
          <div className="rounded-xl bg-card p-4 ring-1 ring-border">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                Selected artists
              </h2>
              <span
                className={[
                  "text-xs font-medium tabular-nums",
                  canContinue ? "text-teal-400" : "text-muted-foreground",
                ].join(" ")}
              >
                {selected.length} / 5
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {selected.map((artist) => (
                <SelectedChip
                  key={artist.id}
                  artist={artist}
                  onRemove={removeArtist}
                />
              ))}
            </div>

            {selected.length < 3 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Select at least {3 - selected.length} more artist
                {3 - selected.length !== 1 ? "s" : ""} to continue.
              </p>
            )}

            <Button
              onClick={handleContinue}
              disabled={!canContinue || pageState === "submitting"}
              className="mt-4 w-full bg-teal-500 text-background hover:bg-teal-400 disabled:opacity-40"
              size="lg"
            >
              {pageState === "submitting" ? (
                <span className="flex items-center gap-2">
                  <span className="size-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                  Saving…
                </span>
              ) : (
                "Continue to your feed"
              )}
            </Button>
          </div>
        </section>
      )}

      {/* Empty state CTA when nothing selected yet */}
      {selected.length === 0 && (
        <p className="mt-auto pt-8 text-center text-sm text-muted-foreground">
          Search above to find artists you love.
        </p>
      )}
    </div>
  )
}

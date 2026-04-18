"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { ArtistCard } from "@/components/feed/artist-card"

interface Track {
  id: string
  spotifyTrackId: string | null
  name: string
  previewUrl: string | null
  durationMs: number
  albumName: string
  albumImageUrl: string | null
  source: "itunes" | "spotify" | "deezer"
}

interface ArtistWithTracks {
  id: string
  name: string
  genres: string[]
  imageUrl: string | null
  popularity: number
  topTracks: Track[]
}

interface Recommendation {
  spotify_artist_id: string
  artist_data: ArtistWithTracks
  score: number
  why: {
    sourceArtists: string[]
    genres: string[]
    friendBoost: string[]
  }
  artist_color?: string | null
}

interface FeedClientProps {
  recommendations: Recommendation[]
  coldStart?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace(/^#/, "")
  const full = cleaned.length === 3 ? cleaned.split("").map((c) => c + c).join("") : cleaned
  const num = parseInt(full.slice(0, 6), 16)
  return `rgba(${(num >> 16) & 0xff}, ${(num >> 8) & 0xff}, ${num & 0xff}, ${alpha})`
}

function stringToVibrantHex(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  const s = 0.70, l = 0.65
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (hue < 60)       { r = c; g = x; b = 0 }
  else if (hue < 120) { r = x; g = c; b = 0 }
  else if (hue < 180) { r = 0; g = c; b = x }
  else if (hue < 240) { r = 0; g = x; b = c }
  else if (hue < 300) { r = x; g = 0; b = c }
  else                { r = c; g = 0; b = x }
  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16)
    return hex.length === 1 ? "0" + hex : hex
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// ---------------------------------------------------------------------------
// Magazine rhythm components
// ---------------------------------------------------------------------------

function FullBleedSpread({ rec }: { rec: Recommendation }) {
  const { artist_data, artist_color } = rec
  const color = artist_color ?? stringToVibrantHex(artist_data.name)
  return (
    <div
      className="fadein"
      style={{
        width: "100%",
        height: 480,
        position: "relative",
        overflow: "hidden",
        borderRadius: "var(--radius-xl)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
      }}
    >
      {artist_data.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artist_data.imageUrl}
          alt={artist_data.name}
          style={{ width: "100%", height: "100%", objectFit: "cover", filter: "saturate(0.85) contrast(1.05)" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: `linear-gradient(135deg, ${hexToRgba(color, 0.4)}, ${hexToRgba(color, 0.15)} 60%, #0a0a0a)`,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 30%, transparent 60%, rgba(0,0,0,0.85) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 28, right: 28, top: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div className="mono" style={{ fontSize: 10, letterSpacing: "0.24em", textTransform: "uppercase", color: "rgba(255,255,255,0.7)" }}>
          Editor&apos;s pick · No. 03
        </div>
        <div className="mono" style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color }}>
          {artist_data.genres[0]}
        </div>
      </div>
      <div style={{ position: "absolute", left: 28, right: 28, bottom: 28 }}>
        <div className="serif" style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", marginBottom: 8, fontStyle: "italic" }}>
          this week, on the flipside —
        </div>
        <div
          className="display"
          style={{ fontSize: "clamp(48px, 10vw, 80px)", lineHeight: 0.88, color: "#fff", textShadow: "0 6px 30px rgba(0,0,0,0.5)" }}
        >
          {artist_data.name}
        </div>
      </div>
    </div>
  )
}

const PULL_QUOTES = [
  { q: "Three nights of Khruangbin and you\u2019re still hungry. Try this.", k: "tonight\u2019s mood" },
  { q: "Quiet records for loud rooms.", k: "a small theory" },
  { q: "The deeper you go, the more the algorithm gets out of the way.", k: "house rules" },
  { q: "Some artists arrive sideways.", k: "field notes" },
]

function PullQuote({ index }: { index: number }) {
  const q = PULL_QUOTES[index % PULL_QUOTES.length]
  return (
    <div className="fadein" style={{ padding: "40px 8px 32px", textAlign: "center", position: "relative" }}>
      <div className="mono" style={{ fontSize: 9.5, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 18 }}>
        — {q.k} —
      </div>
      <div className="serif" style={{ fontSize: "clamp(22px, 4.5vw, 30px)", lineHeight: 1.2, color: "var(--text-primary)", maxWidth: 440, margin: "0 auto", fontStyle: "italic" }}>
        &ldquo;{q.q}&rdquo;
      </div>
    </div>
  )
}

function VsCard({ recA, recB }: { recA: Recommendation; recB: Recommendation }) {
  const colorA = recA.artist_color ?? stringToVibrantHex(recA.artist_data.name)
  const colorB = recB.artist_color ?? stringToVibrantHex(recB.artist_data.name)
  return (
    <div
      className="fadein"
      style={{
        borderRadius: "var(--radius-xl)",
        overflow: "hidden",
        border: "1px solid var(--border)",
        background: "var(--bg-card)",
      }}
    >
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div className="mono" style={{ fontSize: 10, letterSpacing: "0.24em", textTransform: "uppercase", color: "var(--text-muted)" }}>
          A side-by-side
        </div>
        <div className="serif" style={{ fontSize: 13, fontStyle: "italic", color: "var(--text-secondary)" }}>
          which one tonight?
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr" }}>
        <VsHalf rec={recA} color={colorA} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 4px",
            borderLeft: "1px solid var(--border)",
            borderRight: "1px solid var(--border)",
          }}
        >
          <div className="serif" style={{ fontSize: 32, color: "var(--text-muted)", fontStyle: "italic" }}>vs</div>
        </div>
        <VsHalf rec={recB} color={colorB} />
      </div>
    </div>
  )
}

function VsHalf({ rec, color }: { rec: Recommendation; color: string }) {
  const { artist_data } = rec
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ width: "100%", aspectRatio: "1", borderRadius: 12, overflow: "hidden" }}>
        {artist_data.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artist_data.imageUrl} alt={artist_data.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", background: `linear-gradient(135deg, ${hexToRgba(color, 0.4)}, #0a0a0a)` }} />
        )}
      </div>
      <div className="display" style={{ fontSize: 22, lineHeight: 1.0 }}>{artist_data.name}</div>
      <div className="mono" style={{ fontSize: 9.5, color, letterSpacing: "0.16em", textTransform: "uppercase" }}>
        {artist_data.genres[0]}
      </div>
    </div>
  )
}

function ColdStartBanner({ accent, likeCount }: { accent: string; likeCount: number }) {
  const remaining = Math.max(0, 5 - likeCount)
  const pct = Math.min(100, (likeCount / 5) * 100)
  return (
    <div
      className="fadein"
      style={{
        padding: "16px 18px",
        borderRadius: 16,
        marginBottom: 8,
        background: `linear-gradient(135deg, ${hexToRgba(accent, 0.10)}, transparent)`,
        border: `1px solid ${hexToRgba(accent, 0.22)}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>Wandering mode</div>
        <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" }}>
          {likeCount}/5
        </span>
      </div>
      <div className="serif" style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 10, fontStyle: "italic" }}>
        Random discoveries — like {remaining > 0 ? `${remaining} more` : "a few"} to start tuning the engine.
      </div>
      <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: accent, transition: "width .4s" }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Feed sequence builder
// ---------------------------------------------------------------------------

type FeedItem =
  | { kind: "card"; rec: Recommendation; key: string }
  | { kind: "spread"; rec: Recommendation; key: string }
  | { kind: "quote"; index: number; key: string }
  | { kind: "vs"; recA: Recommendation; recB: Recommendation; key: string }

function buildSequence(recs: Recommendation[], magazine: boolean): FeedItem[] {
  const out: FeedItem[] = []
  recs.forEach((rec, i) => {
    out.push({ kind: "card", rec, key: `c-${rec.spotify_artist_id}` })
    if (magazine) {
      if (i === 1) out.push({ kind: "spread", rec: recs[Math.min(2, recs.length - 1)], key: `s-${i}` })
      if (i === 3) out.push({ kind: "quote", index: i, key: `q-${i}` })
      if (i === 4 && recs[5]) out.push({ kind: "vs", recA: recs[4], recB: recs[5], key: `vs-${i}` })
    }
  })
  return out
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FeedClient({ recommendations, coldStart = false }: FeedClientProps) {
  const [dismissedSignals, setDismissedSignals] = useState<Map<string, string>>(new Map())
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [isGenerating, setIsGenerating] = useState(false)
  const router = useRouter()

  const likeCount = useMemo(
    () => Array.from(dismissedSignals.values()).filter((s) => s === "thumbs_up").length,
    [dismissedSignals]
  )

  const activeRec = recommendations.find((r) => !dismissedSignals.has(r.spotify_artist_id))
  const activeAuraColor = activeRec?.artist_color ?? "#8b5cf6"

  const sequence = useMemo(
    () => buildSequence(recommendations, true),
    [recommendations]
  )

  async function handleFeedback(artistId: string, signal: string) {
    setDismissedSignals((prev) => new Map(prev).set(artistId, signal))
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyArtistId: artistId, signal }),
      })
    } catch (err) {
      console.error("[feed-client] feedback failed", err)
    }
  }

  async function handleGenerateMore() {
    setIsGenerating(true)
    try {
      const res = await fetch("/api/recommendations/generate", { method: "POST" })
      if (res.status === 401) {
        window.location.href = "/api/auth/signin"
        return
      }
    } catch (err) {
      console.error("[feed-client] generate failed", err)
    }
    router.refresh()
    setTimeout(() => setIsGenerating(false), 3000)
  }

  async function handleSave(artistId: string) {
    if (savedIds.has(artistId)) {
      setSavedIds((prev) => { const n = new Set(prev); n.delete(artistId); return n })
      try {
        await fetch("/api/saves", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spotifyArtistId: artistId }),
        })
      } catch {}
    } else {
      setSavedIds((prev) => new Set(prev).add(artistId))
      try {
        await fetch("/api/saves", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spotifyArtistId: artistId }),
        })
      } catch (err) {
        console.error("[feed-client] save failed", err)
      }
    }
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Ambient aura */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: "15%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 700,
          height: 700,
          pointerEvents: "none",
          zIndex: -1,
          background: `radial-gradient(circle, ${hexToRgba(activeAuraColor, 0.4)} 0%, transparent 65%)`,
          transition: "background 1s",
        }}
      />

      {/* Page header */}
      <div className="page-head">
        <h1>Today&apos;s feed</h1>
        <span className="sub">{recommendations.length} cued</span>
      </div>

      {/* Cold-start banner */}
      {coldStart && <ColdStartBanner accent="#8b5cf6" likeCount={likeCount} />}

      {/* Feed sequence */}
      <div className="col" style={{ gap: 24, marginTop: 8 }}>
        {sequence.map((item) => {
          if (item.kind === "card") {
            const { rec } = item
            return (
              <ArtistCard
                key={item.key}
                recommendation={rec}
                onSave={() => handleSave(rec.spotify_artist_id)}
                isSaved={savedIds.has(rec.spotify_artist_id)}
                onFeedback={(signal) => handleFeedback(rec.spotify_artist_id, signal)}
                isDismissed={dismissedSignals.has(rec.spotify_artist_id)}
                dismissSignal={dismissedSignals.get(rec.spotify_artist_id) ?? null}
              />
            )
          }
          if (item.kind === "spread") return <FullBleedSpread key={item.key} rec={item.rec} />
          if (item.kind === "quote") return <PullQuote key={item.key} index={item.index} />
          if (item.kind === "vs") return <VsCard key={item.key} recA={item.recA} recB={item.recB} />
          return null
        })}

        {/* Load more */}
        <div style={{ display: "flex", justifyContent: "center", padding: "24px 0 8px" }}>
          <button className="btn" onClick={handleGenerateMore} disabled={isGenerating}>
            {isGenerating ? (
              <span className="mono" style={{ fontSize: 12 }}>Generating…</span>
            ) : (
              "Load more artists"
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

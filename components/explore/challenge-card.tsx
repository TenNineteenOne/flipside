import { Sparkles } from "lucide-react"

export interface ChallengeCardProps {
  title: string
  description: string
  progress: number
  target: number
  completed: boolean
  adventurous?: boolean
}

export function ChallengeCard({
  title,
  description,
  progress,
  target,
  completed,
  adventurous = false,
}: ChallengeCardProps) {
  const pct = Math.min(100, Math.round((progress / target) * 100))

  const accent = completed
    ? { base: "rgb(34,197,94)", tint: "rgba(34,197,94,0.16)", border: "rgba(34,197,94,0.28)" }
    : adventurous
      ? { base: "rgb(255,138,46)", tint: "rgba(255,138,46,0.14)", border: "rgba(255,138,46,0.28)" }
      : { base: "rgb(139,92,246)", tint: "rgba(139,92,246,0.14)", border: "rgba(139,92,246,0.22)" }

  return (
    <section
      aria-label="Weekly challenge"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        marginBottom: 24,
        borderRadius: 14,
        background: "rgba(15,15,15,0.55)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        border: `1px solid ${accent.border}`,
      }}
    >
      <div
        aria-hidden
        style={{
          flex: "0 0 auto",
          width: 38,
          height: 38,
          borderRadius: 13,
          background: accent.tint,
          border: `1px solid ${accent.border}`,
          color: accent.base,
          display: "grid",
          placeItems: "center",
        }}
      >
        <Sparkles size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.2,
              color: "var(--text-primary)",
            }}
          >
            {title}
          </div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.3 }}>
            {description}
          </div>
        </div>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              flex: 1,
              height: 3,
              background: "rgba(255,255,255,0.06)",
              borderRadius: 999,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: accent.base,
                borderRadius: 999,
                transition: "width 0.6s var(--easing)",
              }}
            />
          </div>
          <div
            className="mono"
            style={{
              fontSize: 10.5,
              letterSpacing: "0.08em",
              minWidth: 36,
              textAlign: "right",
              color: "var(--text-muted)",
            }}
          >
            {progress}/{target}
          </div>
        </div>
      </div>
    </section>
  )
}

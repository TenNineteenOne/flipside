"use client"

import { Sparkles } from "lucide-react"

export interface ChallengeCardProps {
  title: string
  description: string
  progress: number
  target: number
  completed: boolean
}

export function ChallengeCard({ title, description, progress, target, completed }: ChallengeCardProps) {
  const pct = Math.min(100, Math.round((progress / target) * 100))

  return (
    <section
      aria-label="Weekly challenge"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: 14,
        marginBottom: 24,
        borderRadius: 12,
        background: completed ? "var(--bg-card-muted, var(--bg-card))" : "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <div
        aria-hidden
        style={{
          flex: "0 0 auto",
          width: 36,
          height: 36,
          borderRadius: 18,
          background: completed ? "rgba(34,197,94,0.15)" : "rgba(139,92,246,0.15)",
          color: completed ? "rgb(34,197,94)" : "rgb(139,92,246)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Sparkles size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
          <div className="muted" style={{ fontSize: 12 }}>
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
              height: 4,
              background: "var(--border)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: completed ? "rgb(34,197,94)" : "rgb(139,92,246)",
                transition: "width 200ms ease",
              }}
            />
          </div>
          <div className="muted" style={{ fontSize: 11, minWidth: 36, textAlign: "right" }}>
            {progress}/{target}
          </div>
        </div>
      </div>
    </section>
  )
}

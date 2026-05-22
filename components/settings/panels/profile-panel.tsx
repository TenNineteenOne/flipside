"use client"

import { IdenticonAvatar } from "@/components/ui/identicon-avatar"
import { hexToRgba } from "@/lib/color-utils"
import { ACCENT, MINT } from "@/lib/settings/obscurity"

interface ProfilePanelProps {
  userSeed: string
}

export function ProfilePanel({ userSeed }: ProfilePanelProps) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10, color: ACCENT }}>Profile</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "16px 18px",
          borderRadius: "var(--radius-lg)",
          background: `linear-gradient(135deg, ${hexToRgba(ACCENT, 0.10)} 0%, rgba(15,15,15,0.65) 60%)`,
          backdropFilter: "blur(30px) saturate(1.1)",
          WebkitBackdropFilter: "blur(30px) saturate(1.1)",
          border: `1px solid ${hexToRgba(ACCENT, 0.22)}`,
        }}
      >
        <div style={{ position: "relative" }}>
          <IdenticonAvatar seed={userSeed} size={48} />
          <span
            aria-hidden
            style={{
              position: "absolute",
              bottom: -2,
              right: -2,
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: MINT,
              border: "2px solid var(--bg-base)",
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Your profile</div>
        </div>
      </div>
    </div>
  )
}

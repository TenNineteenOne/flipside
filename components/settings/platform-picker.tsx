"use client"

import { useRef, type KeyboardEvent } from "react"
import { PLATFORM_META, SUPPORTED_PLATFORMS, type MusicPlatform } from "@/lib/music-links"
import { PlatformIcon } from "@/components/platform-icon"

interface PlatformPickerProps {
  value: MusicPlatform
  onChange: (next: MusicPlatform) => void
  layout?: "row" | "stack"
}

/**
 * Three-option picker for the user's preferred streaming platform. Rendered
 * identically in Settings and in the onboarding flow; shape differences (row
 * vs. stack, helper copy) belong to the caller.
 */
export function PlatformPicker({ value, onChange, layout = "row" }: PlatformPickerProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  function handleKey(e: KeyboardEvent<HTMLButtonElement>, idx: number) {
    const len = SUPPORTED_PLATFORMS.length
    let nextIdx: number | null = null
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIdx = (idx + 1) % len
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIdx = (idx - 1 + len) % len
    else if (e.key === "Home") nextIdx = 0
    else if (e.key === "End") nextIdx = len - 1
    if (nextIdx === null) return
    e.preventDefault()
    const next = SUPPORTED_PLATFORMS[nextIdx]
    onChange(next)
    refs.current[nextIdx]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="Preferred music platform"
      style={{
        display: layout === "row" ? "grid" : "flex",
        gridTemplateColumns: layout === "row" ? "repeat(3, minmax(0, 1fr))" : undefined,
        flexDirection: layout === "row" ? undefined : "column",
        gap: 8,
      }}
    >
      {SUPPORTED_PLATFORMS.map((platform, idx) => {
        const meta = PLATFORM_META[platform]
        const selected = platform === value
        return (
          <button
            key={platform}
            ref={(el) => { refs.current[idx] = el }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(platform)}
            onKeyDown={(e) => handleKey(e, idx)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: layout === "row" ? "center" : "flex-start",
              gap: 8,
              padding: layout === "row" ? "14px 10px" : "14px 16px",
              minHeight: 44,
              borderRadius: 12,
              border: selected
                ? `1.5px solid ${meta.brandColor}`
                : "1px solid var(--border)",
              background: selected
                ? `${meta.brandColor}1a`
                : "rgba(255,255,255,0.03)",
              color: selected ? "var(--text-primary)" : "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              transition: "all 0.15s",
              minWidth: 0,
            }}
          >
            <PlatformIcon platform={platform} size={16} color={meta.brandColor} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {meta.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

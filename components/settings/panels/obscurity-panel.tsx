"use client"

import { useState } from "react"
import { toast } from "sonner"
import { CurvePreview } from "@/components/settings/curve-preview"
import { ToggleSwitch } from "@/components/ui/toggle-switch"
import { hexToRgba } from "@/lib/color-utils"
import { useAdventurousMode } from "@/lib/hooks/use-adventurous-mode"
import { patchSettings } from "@/lib/settings/patch-settings"
import { obscurityLabel, obscurityHelp, obscurityColor, AMBER } from "@/lib/settings/obscurity"
import { curveLabel, curveHelp } from "@/lib/settings/curve-text"

interface ObscurityPanelProps {
  initialPlayThreshold: number
  initialPopularityCurve: number
  initialUndergroundMode: boolean
  initialDeepDiscovery: boolean
  initialAdventurous: boolean
  exampleArtists: { popularity: number; artist: { name: string; popularity: number } | null }[]
  /** Called after a toggle that requires a feed + explore rebuild. */
  onRegenerate: () => void
  /** True while regeneration is in flight (drives button disabled state). */
  isGenerating: boolean
}

export function ObscurityPanel({
  initialPlayThreshold,
  initialPopularityCurve,
  initialUndergroundMode,
  initialDeepDiscovery,
  initialAdventurous,
  exampleArtists,
  onRegenerate,
  isGenerating,
}: ObscurityPanelProps) {
  const [threshold, setThreshold] = useState(initialPlayThreshold)
  const [popularityCurve, setPopularityCurve] = useState(initialPopularityCurve)
  const [undergroundMode, setUndergroundMode] = useState(initialUndergroundMode)
  const [deepDiscovery, setDeepDiscovery] = useState(initialDeepDiscovery)
  const { adventurous, setAdventurous } = useAdventurousMode(initialAdventurous)

  const obsColor = obscurityColor(threshold)
  const obsLabel = obscurityLabel(threshold)
  const obsHelp = obscurityHelp(threshold)
  const obsPct = Math.round((threshold / 50) * 100)
  const obsSliderBg = `linear-gradient(to right, ${obsColor} ${obsPct}%, rgba(255,255,255,0.10) ${obsPct}%)`

  const curvePct = Math.round(((popularityCurve - 0.9) / 0.1) * 100)
  const curveBg = `linear-gradient(to right, var(--accent) ${curvePct}%, rgba(255,255,255,0.10) ${curvePct}%)`
  const cLabel = curveLabel(popularityCurve)
  const cHelp = curveHelp(popularityCurve)

  async function handleThresholdRelease() {
    try {
      await patchSettings({ playThreshold: threshold })
    } catch {
      toast.error("Failed to save familiarity")
    }
  }

  async function handleCurveRelease() {
    try {
      await patchSettings({ popularityCurve })
    } catch {
      toast.error("Failed to save popularity preference")
    }
  }

  async function handleUndergroundToggle() {
    const next = !undergroundMode
    setUndergroundMode(next)
    try {
      await patchSettings({ undergroundMode: next })
      void onRegenerate()
    } catch {
      setUndergroundMode(!next)
      toast.error("Failed to save setting")
    }
  }

  async function handleDeepDiscoveryToggle() {
    const next = !deepDiscovery
    setDeepDiscovery(next)
    try {
      await patchSettings({ deepDiscovery: next })
      void onRegenerate()
    } catch {
      setDeepDiscovery(!next)
      toast.error("Failed to save setting")
    }
  }

  async function handleAdventurousToggle() {
    try {
      await setAdventurous(!adventurous)
      void onRegenerate()
    } catch {
      toast.error("Failed to save setting")
    }
  }

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10, color: obsColor }}>How underground?</div>
      <div
        className="fs-card col gap-16"
        style={{
          background: `linear-gradient(135deg, ${hexToRgba(obsColor, 0.12)} 0%, rgba(15,15,15,0.65) 70%)`,
          borderColor: hexToRgba(obsColor, 0.24),
          transition: "background 0.6s, border-color 0.6s",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <div
              className="serif"
              style={{
                fontSize: 24,
                color: obsColor,
                letterSpacing: "-0.01em",
                fontWeight: 500,
                transition: "color 0.4s",
              }}
            >
              {obsLabel}
            </div>
            <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
              hide if played &gt; {threshold}&times;
            </div>
          </div>
          <input
            type="range"
            className="obs-slider"
            min={0}
            max={50}
            step={1}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            onPointerUp={handleThresholdRelease}
            onKeyUp={handleThresholdRelease}
            style={{ background: obsSliderBg }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            <span>&larr; deep underground</span>
            <span>familiar &rarr;</span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
            {obsHelp}
          </div>
        </div>

        <div className="divider" />

        {/* Fine-tune sub-controls */}
        <div className="eyebrow" style={{ color: "var(--text-muted)" }}>Fine-tune</div>

        {/* Popularity curve */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>{cLabel}</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
              k = {popularityCurve.toFixed(3)}
            </div>
          </div>
          <input
            type="range"
            className="obs-slider"
            min={0.9}
            max={1.0}
            step={0.005}
            value={popularityCurve}
            onChange={(e) => setPopularityCurve(Number(e.target.value))}
            onPointerUp={handleCurveRelease}
            onKeyUp={handleCurveRelease}
            style={{ background: curveBg }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            <span>&larr; niche</span>
            <span>mainstream &rarr;</span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
            {cHelp}
          </div>
        </div>

        <CurvePreview
          popularityCurve={popularityCurve}
          undergroundMode={undergroundMode}
          adventurous={adventurous}
          exampleArtists={exampleArtists}
        />

        <div className="divider" />

        {/* Extra obscure */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Extra obscure</div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              Drops every artist above pop 50 entirely, and penalizes the rest on top of the curve above.
            </div>
          </div>
          <ToggleSwitch checked={undergroundMode} onClick={handleUndergroundToggle} />
        </div>

        <div className="divider" />

        {/* Deep discovery */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Deep discovery</div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              Walks two artists deep into similar-artist chains. More obscure picks; occasional genre drift.
            </div>
          </div>
          <ToggleSwitch checked={deepDiscovery} onClick={handleDeepDiscoveryToggle} />
        </div>

        <div className="divider" />

        {/* Adventurous mode */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: adventurous ? AMBER : undefined, transition: "color 0.3s" }}>
              Adventurous mode
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              Pulls in adjacent genres, adds extra variety, and leads with less-familiar picks across your feed and Explore.
            </div>
          </div>
          <ToggleSwitch checked={adventurous} onClick={handleAdventurousToggle} tint={AMBER} />
        </div>

        <button
          onClick={onRegenerate}
          disabled={isGenerating}
          className="btn"
          style={{
            width: "100%",
            marginTop: 4,
            color: "#0a0a0a",
            fontWeight: 600,
            border: 0,
            cursor: isGenerating ? "default" : "pointer",
            opacity: isGenerating ? 0.75 : 1,
            background: adventurous
              ? "linear-gradient(135deg, rgba(245,176,71,0.95) 0%, rgba(236,111,181,0.85) 45%, rgba(125,217,198,0.75) 80%, rgba(168,199,250,0.70) 100%)"
              : AMBER,
            boxShadow: adventurous ? "0 0 24px rgba(245,176,71,0.28)" : "none",
            transition: "background 0.3s, box-shadow 0.3s",
          }}
        >
          {isGenerating ? "Regenerating…" : "Regenerate feed & Explore →"}
        </button>
      </div>
    </div>
  )
}

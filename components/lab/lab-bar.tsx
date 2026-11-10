"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LAB_OPTIONS } from "@/lib/lab/options"

/** Tiny floating switcher shown on every prototype (not on the gallery itself). */
export function LabBar() {
  const pathname = usePathname()
  const [, , slug, sub] = pathname.split("/")
  const i = LAB_OPTIONS.findIndex((o) => o.slug === slug)
  if (i < 0) return null
  const next = LAB_OPTIONS[(i + 1) % LAB_OPTIONS.length]
  const pill = (active: boolean) =>
    ({ padding: "5px 10px", borderRadius: 999, color: active ? "#111" : "#eee", background: active ? "#fff" : "transparent", textDecoration: "none" }) as const
  return (
    <nav
      className="lab-bar"
      aria-label="Design lab"
      style={{
        position: "fixed", left: "50%", bottom: 12, transform: "translateX(-50%)", zIndex: 2000,
        display: "flex", alignItems: "center", gap: 2, padding: 4, borderRadius: 999,
        background: "rgba(17,17,17,0.92)", border: "1px solid rgba(255,255,255,0.18)",
        font: "600 12px/1 system-ui, sans-serif", whiteSpace: "nowrap", boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
      }}
    >
      <Link href="/lab" style={pill(false)}>← Lab</Link>
      <span style={{ padding: "5px 8px", color: "#999" }}>{LAB_OPTIONS[i].name}</span>
      <Link href={`/lab/${slug}`} style={pill(!sub)}>Landing</Link>
      <Link href={`/lab/${slug}/app`} style={pill(sub === "app")}>App</Link>
      <Link href={`/lab/${next.slug}`} style={pill(false)}>Next →</Link>
    </nav>
  )
}

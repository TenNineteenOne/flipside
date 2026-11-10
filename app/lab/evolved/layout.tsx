import { Familjen_Grotesk, Martian_Mono } from "next/font/google"
import "./evolved.css"

// Familjen Grotesk: a grotesk with ink-trap warmth, carries the lowercase wordmark and all UI.
// Martian Mono: key hints, durations, counts — the "hardware" layer.
const sans = Familjen_Grotesk({ subsets: ["latin", "latin-ext"], weight: "variable", variable: "--ev-sans", display: "swap" })
const mono = Martian_Mono({ subsets: ["latin", "latin-ext"], weight: ["400", "500"], variable: "--ev-mono", display: "swap" })

export default function EvolvedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`lab-evolved ${sans.variable} ${mono.variable}`}>
      <style>{`body{background:#121015}`}</style>
      {children}
    </div>
  )
}

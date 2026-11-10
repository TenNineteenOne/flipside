import type { Metadata } from "next"
import { Archivo } from "next/font/google"
import "./tuner.css"

// One family, two voices: the width axis gives condensed display names and wide engraved labels.
const archivo = Archivo({ subsets: ["latin", "latin-ext"], axes: ["wdth"], variable: "--font-tuner", display: "swap" })

export const metadata: Metadata = { title: "Flipside FM" }

export default function TunerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`lab-tuner ${archivo.variable}`}>
      <style>{`body{background:#151311}`}</style>
      {children}
    </div>
  )
}

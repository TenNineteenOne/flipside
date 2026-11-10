import type { Metadata } from "next"
import { Overpass } from "next/font/google"
import "./atlas.css"

// Overpass descends from Highway Gothic, the lettering on US road signs: a map's own voice, with true italics for regions.
const overpass = Overpass({ subsets: ["latin", "latin-ext"], style: ["normal", "italic"], variable: "--font-atlas", display: "swap" })

export const metadata: Metadata = { title: "Atlas · Flipside design lab" }

export default function AtlasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`lab-atlas ${overpass.variable}`}>
      <style>{`body{background:#f3f6f8}`}</style>
      {children}
    </div>
  )
}

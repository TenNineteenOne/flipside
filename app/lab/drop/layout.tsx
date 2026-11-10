import { Anybody, Familjen_Grotesk } from "next/font/google"
import "./drop.css"

// Anybody: variable width 50–150, so artist names can be set like wood type (condensed or extended to fill the line).
const display = Anybody({ subsets: ["latin", "latin-ext"], axes: ["wdth"], variable: "--d-display", display: "swap" })
const body = Familjen_Grotesk({ subsets: ["latin", "latin-ext"], variable: "--d-body", display: "swap" })

export const metadata = { title: "Flipside · The Daily Drop" }

export default function DropLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`lab-drop ${display.variable} ${body.variable}`}>
      <style>{`body{background:#ffe03a}`}</style>
      {children}
    </div>
  )
}

import { Archivo, Spectral } from "next/font/google"
import { labArtists } from "@/lib/lab/artists"
import { themeVars } from "@/components/lab/bside/color"
import "@/components/lab/bside/bside.css"

// Archivo's width axis does the record-label poster work (condensed heavy names) and the UI work (normal width).
const archivo = Archivo({ subsets: ["latin", "latin-ext"], axes: ["wdth"], variable: "--bs-font-display", display: "swap" })
// Spectral for the liner notes: a reading face, set like the back of a sleeve.
const spectral = Spectral({ subsets: ["latin", "latin-ext"], weight: ["400"], style: ["normal", "italic"], variable: "--bs-font-text", display: "swap" })

export default function BsideLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`lab-bside ${archivo.variable} ${spectral.variable}`} style={themeVars(labArtists[0])}>
      {children}
    </div>
  )
}

import type { Metadata } from "next"
import { AudioProvider } from "@/lib/audio-context"
import { LabBar } from "@/components/lab/lab-bar"

export const metadata: Metadata = { title: "Design lab", robots: { index: false } }

// Prototypes only. Turns off the production grain overlay so each direction owns its surface.
export default function LabLayout({ children }: { children: React.ReactNode }) {
  return (
    <AudioProvider>
      {/* Lab bar is hidden on phones so it never covers a prototype's own bottom navigation. */}
      <style>{`body::after{display:none}@media (max-width:899px){.lab-bar{display:none!important}}`}</style>
      {children}
      <LabBar />
    </AudioProvider>
  )
}

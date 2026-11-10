import { describe, it, expect, vi } from "vitest"
import { renderToString } from "react-dom/server"

const patchSettings = vi.fn<(p: unknown) => Promise<void>>(async () => {})
vi.mock("@/lib/settings/patch-settings", () => ({ patchSettings: (p: unknown) => patchSettings(p) }))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { DiscoveryPanel, saveFameLevel } from "./discovery-panel"

describe("DiscoveryPanel", () => {
  it("saves the fame stop as fameLevel", async () => {
    await saveFameLevel(3)
    expect(patchSettings).toHaveBeenCalledWith({ fameLevel: 3 })
  })

  it("shows the 5-stop How famous? slider and the Wander farther switch; the old knobs are gone", () => {
    const html = renderToString(<DiscoveryPanel initialFameLevel={2} initialAdventurous />).replaceAll("<!-- -->", "")
    expect(html).toContain("How famous?")
    expect(html).toMatch(/type="range"[^>]*min="0" max="4" step="1"[^>]*aria-valuetext="Balanced"/)
    expect(html).toContain(">Balanced<")
    expect(html).toContain("How close to your taste?")
    expect(html).toMatch(/role="switch" aria-checked="true" aria-label="Wander farther" aria-describedby="[^"]+"/)
    expect(html).toContain("About half of each new batch comes from outside your usual genres. Also on Feed.")
    for (const gone of ["Popularity curve", "Extra obscure", "Deep discovery", "Regenerate", "hide if played"]) expect(html).not.toContain(gone)
  })
})

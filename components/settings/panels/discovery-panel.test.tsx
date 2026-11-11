import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderToString } from "react-dom/server"

const patchSettings = vi.fn<(p: unknown) => Promise<void>>(async () => {})
vi.mock("@/lib/settings/patch-settings", () => ({ patchSettings: (p: unknown) => patchSettings(p) }))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { DiscoveryPanel, saveFameLevel } from "./discovery-panel"

describe("DiscoveryPanel", () => {
  beforeEach(() => patchSettings.mockReset())

  it("saves a changed fame stop as fameLevel and remembers it", async () => {
    const saved = { current: 2 }
    await saveFameLevel(3, saved, vi.fn())
    expect(patchSettings).toHaveBeenCalledWith({ fameLevel: 3 })
    expect(saved.current).toBe(3)
  })

  it("a pointerup / keyup that didn't move the slider sends no PATCH", async () => {
    const saved = { current: 2 }
    await saveFameLevel(2, saved, vi.fn())
    await saveFameLevel(3, saved, vi.fn())
    await saveFameLevel(3, saved, vi.fn()) // e.g. a Tab keyup after the move
    expect(patchSettings).toHaveBeenCalledTimes(1)
  })

  it("a failed save rolls the slider back to the last saved stop", async () => {
    patchSettings.mockRejectedValueOnce(new Error("nope"))
    const saved = { current: 2 }
    const rollback = vi.fn()
    await saveFameLevel(0, saved, rollback)
    expect(rollback).toHaveBeenCalledWith(2)
    expect(saved.current).toBe(2)
  })

  it("shows the 5-stop How famous? slider and the Wander farther switch; the old knobs are gone", () => {
    const html = renderToString(<DiscoveryPanel initialFameLevel={2} initialAdventurous />).replaceAll("<!-- -->", "")
    expect(html).toContain("How famous?")
    expect(html).toMatch(/type="range"[^>]*min="0" max="4" step="1"[^>]*aria-valuetext="Balanced"/)
    expect(html).toContain(">Balanced<")
    expect(html).toContain("How close to your taste?")
    expect(html).toMatch(/role="switch" aria-checked="true" aria-label="Wander farther" aria-describedby="[^"]+"/)
    expect(html).toContain("About half of each batch comes from outside your usual genres.")
    for (const gone of ["Popularity curve", "Extra obscure", "Deep discovery", "Regenerate", "hide if played"]) expect(html).not.toContain(gone)
  })
})

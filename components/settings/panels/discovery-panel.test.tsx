import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderToString } from "react-dom/server"

const patchSettings = vi.fn<(p: unknown) => Promise<void>>(async () => {})
vi.mock("@/lib/settings/patch-settings", () => ({ patchSettings: (p: unknown) => patchSettings(p) }))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

import { DiscoveryPanel, createFameWriter } from "./discovery-panel"

describe("DiscoveryPanel", () => {
  beforeEach(() => patchSettings.mockReset())

  it("saves a changed fame stop as fameLevel", async () => {
    const write = createFameWriter(2, vi.fn())
    await write(3)
    expect(patchSettings).toHaveBeenCalledWith({ fameLevel: 3 })
  })

  it("a value equal to the last requested one sends no PATCH", async () => {
    const write = createFameWriter(2, vi.fn())
    await write(2)
    await write(3)
    await write(3)
    expect(patchSettings).toHaveBeenCalledTimes(1)
  })

  it("saves run in call order: a slow older PATCH finishes before the newer one starts", async () => {
    const order: string[] = []
    let release!: () => void
    patchSettings.mockImplementationOnce(async (p) => { order.push(`start ${JSON.stringify(p)}`); await new Promise<void>((r) => { release = r }); order.push("end 1") })
    patchSettings.mockImplementationOnce(async (p) => { order.push(`start ${JSON.stringify(p)}`) })
    const write = createFameWriter(2, vi.fn())
    void write(1)
    const last = write(4)
    await Promise.resolve()
    release()
    await last
    expect(order).toEqual(['start {"fameLevel":1}', "end 1", 'start {"fameLevel":4}'])
  })

  it("a failed newest save rolls back to the last confirmed stop; an older failure doesn't", async () => {
    const rollback = vi.fn()
    const write = createFameWriter(2, rollback)
    patchSettings.mockRejectedValueOnce(new Error("nope"))
    void write(0)
    await write(3)
    expect(rollback).not.toHaveBeenCalled()
    patchSettings.mockRejectedValueOnce(new Error("nope"))
    await write(1)
    expect(rollback).toHaveBeenCalledWith(3)
  })

  it("a failure while a newer change is pending (supersede) doesn't roll back, and the same value can be re-sent", async () => {
    const rollback = vi.fn()
    const write = createFameWriter(1, rollback)
    patchSettings.mockRejectedValueOnce(new Error("nope"))
    const first = write(3)
    write.supersede() // user still dragging; the next value is debounced
    await first
    expect(rollback).not.toHaveBeenCalled()
    await write(3) // the pending value happens to equal the failed one: still sent
    expect(patchSettings).toHaveBeenLastCalledWith({ fameLevel: 3 })
    expect(patchSettings).toHaveBeenCalledTimes(2)
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

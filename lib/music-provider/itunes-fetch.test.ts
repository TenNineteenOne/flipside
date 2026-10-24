import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { itunesFetch } from "./itunes"
import { resetCalls, snapshotCalls } from "@/lib/recommendation/api-call-counter"

const URL_ = "https://itunes.apple.com/search?term=x"

describe("itunesFetch", () => {
  beforeEach(() => resetCalls())
  afterEach(() => vi.unstubAllGlobals())

  it("returns parsed JSON and counts the call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [1] }))))
    expect(await itunesFetch(URL_)).toEqual({ ok: true, data: { results: [1] } })
    expect(snapshotCalls().itunes).toBe(1)
  })

  it("reports http / network / parse failures without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })))
    expect(await itunesFetch(URL_)).toEqual({ ok: false, reason: "http", status: 500 })

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout") }))
    expect(await itunesFetch(URL_)).toMatchObject({ ok: false, reason: "network" })

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json")))
    expect(await itunesFetch(URL_)).toMatchObject({ ok: false, reason: "parse" })
  })

  // Runs last: it leaves the module-global breaker open.
  it("opens the breaker after 5 consecutive 429s and then skips the network + counter", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 429 }))
    // A success first resets any failures left by the previous test.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")))
    await itunesFetch(URL_)
    vi.stubGlobal("fetch", fetchMock)
    for (let i = 0; i < 5; i++) await itunesFetch(URL_)
    expect(fetchMock).toHaveBeenCalledTimes(5)

    resetCalls()
    expect(await itunesFetch(URL_)).toEqual({ ok: false, reason: "breaker" })
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(snapshotCalls().itunes).toBe(0)
  })
})

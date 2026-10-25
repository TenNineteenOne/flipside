import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const vibrantFrom = vi.fn()
vi.mock("node-vibrant/node", () => ({ Vibrant: { from: (b: Buffer) => vibrantFrom(b) } }))

import { extractArtistColor } from "./colour-extraction"

const FALLBACK = "#8b5cf6"
const URL_OK = "https://i.scdn.co/image/abc"

function serve(bytes: number[]) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 })))
}

beforeEach(() => {
  vibrantFrom.mockReset()
  vibrantFrom.mockReturnValue({ getPalette: async () => ({ Vibrant: { rgb: [250, 200, 100] } }) })
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("extractArtistColor magic-byte gate (#175 S7)", () => {
  it.each([
    ["JPEG", [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]],
    ["PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]],
    ["WebP", [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]],
  ])("%s reaches node-vibrant", async (_label, bytes) => {
    serve(bytes)
    expect(await extractArtistColor(URL_OK)).toBe("#fac864")
    expect(vibrantFrom).toHaveBeenCalledOnce()
  })

  it.each([
    // ASF header GUID: the GHSA-5v7r-6r5c-r473 parser-loop trigger.
    ["ASF", [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa]],
    ["HTML", [...Buffer.from("<!doctype html>")]],
    ["empty", []],
  ])("%s returns the fallback without parsing", async (_label, bytes) => {
    serve(bytes)
    expect(await extractArtistColor(URL_OK)).toBe(FALLBACK)
    expect(vibrantFrom).not.toHaveBeenCalled()
  })
})

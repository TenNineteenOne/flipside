import { describe, it, expect } from "vitest"
import { safeFrom } from "./safe-from"

describe("safeFrom", () => {
  it.each([
    ["/settings", "/settings"],
    ["/history?x=1#a", "/history?x=1#a"],
    ["/", "/"],
  ])("keeps same-origin path %s", (raw, want) => expect(safeFrom(raw)).toBe(want))

  it.each([
    undefined, "", "feed", "//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)",
    ["/settings"], "/\t/evil.com",
    // dot segments that normalise back to a protocol-relative URL
    "/.//evil.com", "/..//evil.com", "/%2e//evil.com", "/a/..//evil.com", "/./\\evil.com",
  ])("falls back to /feed for %j", (raw) => expect(safeFrom(raw)).toBe("/feed"))
})

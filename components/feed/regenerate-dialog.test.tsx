import { describe, expect, it } from "vitest"
import { renderToString } from "react-dom/server"
import { localDay, RegenerateDialog, shouldConfirm } from "./regenerate-dialog"

describe("regenerate confirm", () => {
  it("asks only when unrated cards would be lost and today isn't opted out", () => {
    expect(shouldConfirm(5, null, "2026-11-12")).toBe(true)
    expect(shouldConfirm(5, "2026-11-11", "2026-11-12")).toBe(true) // yesterday's opt-out expired
    expect(shouldConfirm(5, "2026-11-12", "2026-11-12")).toBe(false)
    expect(shouldConfirm(0, null, "2026-11-12")).toBe(false)
  })

  it("localDay is the viewer's local date, zero-padded", () => {
    expect(localDay(new Date(2026, 0, 3, 23, 59))).toBe("2026-01-03")
  })

  it("renders the question, the count, the opt-out and both buttons", () => {
    const html = renderToString(<RegenerateDialog open={false} remaining={12} onCancel={() => {}} onConfirm={() => {}} />).replaceAll("<!-- -->", "")
    expect(html).toContain("Regenerate your feed?")
    expect(html).toContain("Your 12 unrated artists will be replaced.")
    expect(html).toMatch(/<input type="checkbox"\/>Don’t ask again today/)
    expect(html).toContain(">Cancel</button>")
    expect(html).toContain(">Yes, regenerate</button>")
  })
})

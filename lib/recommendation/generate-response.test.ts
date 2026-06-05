import { describe, it, expect } from "vitest"
import { classifyGenerateResponse } from "./generate-response"

describe("classifyGenerateResponse", () => {
  it("treats 429 as in-flight (poll, don't error)", () => {
    expect(classifyGenerateResponse(429, { error: "Please wait before generating more recommendations" }))
      .toBe("in-flight")
  })

  it("treats a full-queue 429 as ready (there are already recs to show)", () => {
    expect(classifyGenerateResponse(429, { error: "Your discovery queue is full. Please review some artists before generating more." }))
      .toBe("ready")
  })

  it("treats 2xx as ready", () => {
    expect(classifyGenerateResponse(200, { count: 20 })).toBe("ready")
  })

  it("treats count:0 success as error (nothing found)", () => {
    expect(classifyGenerateResponse(200, { count: 0 })).toBe("error")
  })

  it("treats 5xx as error", () => {
    expect(classifyGenerateResponse(503, { error: "Music service temporarily unavailable" })).toBe("error")
  })
})

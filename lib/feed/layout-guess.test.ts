import { describe, expect, it } from "vitest"
import { guessFeedLayout } from "./layout-guess"

const h = (o: Record<string, string>) => new Headers(o)
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
}

describe("guessFeedLayout", () => {
  it("trusts the mobile client hint", () => {
    expect(guessFeedLayout(h({ "sec-ch-ua-mobile": "?1", "user-agent": UA.mac }))).toBe("phone")
    expect(guessFeedLayout(h({ "sec-ch-ua-mobile": "?0", "user-agent": UA.android }))).toBe("desktop")
  })

  it("falls back to the user agent", () => {
    expect(guessFeedLayout(h({ "user-agent": UA.iphone }))).toBe("phone")
    expect(guessFeedLayout(h({ "user-agent": UA.android }))).toBe("phone")
    // An Android tablet without the hint is guessed as a phone (Chrome sends ?0 for it).
    expect(guessFeedLayout(h({ "user-agent": UA.androidTablet }))).toBe("phone")
    expect(guessFeedLayout(h({ "sec-ch-ua-mobile": "?0", "user-agent": UA.androidTablet }))).toBe("desktop")
    expect(guessFeedLayout(h({ "user-agent": UA.firefoxAndroid }))).toBe("phone")
    expect(guessFeedLayout(h({ "user-agent": UA.mac }))).toBe("desktop")
    expect(guessFeedLayout(h({ "user-agent": UA.ipad }))).toBe("desktop")
    expect(guessFeedLayout(h({}))).toBe("desktop")
  })
})

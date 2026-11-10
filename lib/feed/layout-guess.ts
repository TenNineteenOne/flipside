/** The three feed layouts (PRD "Breakpoints"); FeedClient picks the real one with matchMedia. */
export type FeedLayout = "phone" | "tablet" | "desktop"

/**
 * The server's guess at the feed layout, so the first paint is the right tree for most
 * visitors: phones get the Snap feed, everything else the desktop one (a tablet can't be
 * told from a desktop by its headers; FeedClient switches after hydration when the guess
 * is wrong). Prefers the `Sec-CH-UA-Mobile` client hint (Chromium), else the user agent.
 */
export function guessFeedLayout(headers: { get(name: string): string | null }): FeedLayout {
  const hint = headers.get("sec-ch-ua-mobile")
  if (hint === "?1") return "phone"
  if (hint === "?0") return "desktop"
  return /Mobi|Android|iPhone|iPod/i.test(headers.get("user-agent") ?? "") ? "phone" : "desktop"
}

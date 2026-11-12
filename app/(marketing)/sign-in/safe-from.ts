const BASE = "http://flipside.invalid"

/**
 * The post-sign-in destination from `?from=`: a same-origin path, else /feed.
 * Rejects protocol-relative ("//evil", "/\evil": browsers treat "\" as "/") and
 * anything that resolves off-origin.
 */
export function safeFrom(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw[1] === "/" || raw[1] === "\\") return "/feed"
  try {
    const url = new URL(raw, BASE)
    if (url.origin !== BASE) return "/feed"
    return url.pathname + url.search + url.hash
  } catch {
    return "/feed"
  }
}

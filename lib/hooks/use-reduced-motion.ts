import { useSyncExternalStore } from "react"

const QUERY = "(prefers-reduced-motion: reduce)"
const subscribe = (cb: () => void) => {
  const m = matchMedia(QUERY)
  m.addEventListener("change", cb)
  return () => m.removeEventListener("change", cb)
}

/** The user's reduced-motion preference (false on the server and in the first render). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => matchMedia(QUERY).matches, () => false)
}

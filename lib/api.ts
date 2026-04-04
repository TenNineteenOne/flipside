import { toastError } from "@/lib/toast"

export async function apiFetch<T>(
  url: string,
  options?: RequestInit
): Promise<{ data: T | null; error: string | null }> {
  try {
    const response = await fetch(url, options)

    if (!response.ok) {
      let message: string
      try {
        const body = await response.json()
        message = body?.error ?? response.statusText
      } catch {
        message = response.statusText
      }
      toastError(message)
      return { data: null, error: message }
    }

    const data: T = await response.json()
    return { data, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred"
    toastError(message)
    return { data: null, error: message }
  }
}

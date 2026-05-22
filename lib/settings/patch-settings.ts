/**
 * Thin wrapper around PATCH /api/settings.
 * Throws with the server's error message if the response is not ok.
 */
export async function patchSettings(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? "Failed to save")
  }
}

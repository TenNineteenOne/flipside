export function apiError(message: string, status = 500): Response {
  return Response.json({ error: message }, { status })
}

export function apiUnauthorized(): Response {
  return apiError("Unauthorized", 401)
}

export function apiNotFound(): Response {
  return apiError("Not found", 404)
}

/**
 * Log the real DB error server-side; return a generic message to the client.
 * An artist foreign-key violation (23503 naming `artist_id`: a well-formed but
 * unknown/merged artist uuid) is the client's error → 404, not a 500.
 */
export function dbError(error: { message: string; code?: string; details?: string }, context: string): Response {
  console.error(`[${context}]`, error.message)
  if (error.code === "23503" && `${error.message} ${error.details ?? ""}`.includes("artist_id")) {
    return apiError("Artist not found", 404)
  }
  return apiError("An unexpected error occurred", 500)
}

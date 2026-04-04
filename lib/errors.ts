export function apiError(message: string, status = 500): Response {
  return Response.json({ error: message }, { status })
}

export function apiUnauthorized(): Response {
  return apiError("Unauthorized", 401)
}

export function apiNotFound(): Response {
  return apiError("Not found", 404)
}

/** Log the real DB error server-side; return a generic message to the client. */
export function dbError(error: { message: string }, context: string): Response {
  console.error(`[${context}]`, error.message)
  return apiError("An unexpected error occurred", 500)
}

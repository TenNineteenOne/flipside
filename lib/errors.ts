export function apiError(message: string, status = 500): Response {
  return Response.json({ error: message }, { status })
}

export function apiUnauthorized(): Response {
  return apiError("Unauthorized", 401)
}

export function apiNotFound(): Response {
  return apiError("Not found", 404)
}

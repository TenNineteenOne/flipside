import { type NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"
import { getAccessToken } from "@/lib/get-access-token"
import { musicProvider } from "@/lib/music-provider/provider"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { withAuthedCsrfRoute } from "@/lib/api/with-authed-route"

// withAuthedCsrfRoute (not withAuthedJsonRoute): this route checks the Spotify
// access token BEFORE parsing the body, so a missing/expired token 401s ahead
// of a body-parse failure — preserving that check order needs body-parsing
// done locally rather than by the wrapper.
export const POST = withAuthedCsrfRoute(async ({ request }): Promise<Response> => {
  const req = request as NextRequest
  const accessToken = await getAccessToken(req)
  if (!accessToken) return apiUnauthorized()

  let body: { trackId?: string }
  try {
    body = await req.json()
  } catch {
    return apiError("Invalid JSON", 400)
  }

  const { trackId } = body
  if (!trackId || !isValidSpotifyId(trackId)) {
    return apiError("Valid trackId required", 400)
  }

  try {
    await musicProvider.likeTrack(accessToken, trackId)
    return Response.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    // On failure, surface token state so we can triage expired-scope vs stale-token.
    const token = await getToken({
      req,
      secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
      secureCookie: process.env.NODE_ENV === "production",
    })
    const expiresAt = token?.expiresAt as number | undefined
    const expiresIn = expiresAt ? Math.round(expiresAt - Date.now() / 1000) : null
    console.error(
      `[like] fail trackId=${trackId} err=${msg} expiresIn=${expiresIn}s tokenError=${token?.error ?? 'none'}`
    )
    if (msg === 'scope_missing') {
      return apiError("scope_missing", 403)
    }
    if (msg === 'auth_expired') return apiUnauthorized()
    return apiError("Failed to like track", 500)
  }
})

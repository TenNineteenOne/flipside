import { type NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"
import { auth } from "@/lib/auth"
import { getAccessToken } from "@/lib/get-access-token"
import { musicProvider } from "@/lib/music-provider/provider"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import { apiError, apiUnauthorized } from "@/lib/errors"
import { enforceSameOrigin } from "@/lib/csrf"

export async function POST(req: NextRequest): Promise<Response> {
  const blocked = enforceSameOrigin(req)
  if (blocked) return blocked
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

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
}

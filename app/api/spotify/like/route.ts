import { type NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"
import { auth } from "@/lib/auth"
import { getAccessToken } from "@/lib/get-access-token"
import { musicProvider } from "@/lib/music-provider/provider"
import { isValidSpotifyId } from "@/lib/spotify-ids"
import { apiError, apiUnauthorized } from "@/lib/errors"

export async function POST(req: NextRequest): Promise<Response> {
  const session = await auth()
  if (!session?.user?.spotifyId) return apiUnauthorized()

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

  console.log(`[like] start trackId=${trackId}`)

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    secureCookie: process.env.NODE_ENV === "production",
  })
  const expiresAt = token?.expiresAt as number | undefined
  const expiresIn = expiresAt ? Math.round(expiresAt - Date.now() / 1000) : null
  console.log(`[like] token-state expiresIn=${expiresIn}s tokenError=${token?.error ?? 'none'}`)

  try {
    await musicProvider.likeTrack(accessToken, trackId)
    console.log(`[like] ok trackId=${trackId}`)
    return Response.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[like] fail trackId=${trackId} err=${msg}`)
    if (msg === 'scope_missing') {
      return apiError("scope_missing", 403)
    }
    if (msg === 'auth_expired') return apiUnauthorized()
    return apiError("Failed to like track", 500)
  }
}

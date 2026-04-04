import { getToken } from "next-auth/jwt"
import type { NextRequest } from "next/server"

/**
 * Server-only helper. Reads the Spotify access token directly from the
 * encrypted JWT cookie — it is never included in the public session object
 * returned by GET /api/auth/session.
 */
export async function getAccessToken(req: NextRequest): Promise<string | null> {
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  })
  return (token?.accessToken as string) ?? null
}

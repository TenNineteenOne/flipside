import NextAuth from "next-auth"
import Spotify from "next-auth/providers/spotify"

const SPOTIFY_SCOPES = [
  "user-top-read",
  "user-read-recently-played",
  "playlist-modify-private",
  "playlist-modify-public",
].join(" ")

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  providers: [
    Spotify({
      clientId: process.env.SPOTIFY_CLIENT_ID!,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
      authorization: {
        url: "https://accounts.spotify.com/authorize",
        params: { scope: SPOTIFY_SCOPES },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // On first login, store Spotify tokens and profile in JWT
      if (account && profile) {
        return {
          ...token,
          spotifyId: profile.id,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
          displayName: (profile as any).display_name,
          avatarUrl: (profile as any).images?.[0]?.url ?? null,
        }
      }
      // No refresh token = no session, return as-is
      if (!token.refreshToken) return token
      // Token still valid
      if (Date.now() < (token.expiresAt as number) * 1000) return token
      // Token expired — refresh it
      return refreshSpotifyToken(token)
    },
    async session({ session, token }) {
      session.user.spotifyId = token.spotifyId as string
      session.user.displayName = token.displayName as string
      session.user.avatarUrl = token.avatarUrl as string | null
      // accessToken is intentionally omitted — read via getToken() in server-only code
      if (token.error) console.error("[auth] token error:", token.error)
      return session
    },
  },
})

async function refreshSpotifyToken(token: any) {
  try {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
        client_id: process.env.SPOTIFY_CLIENT_ID!,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw data
    return {
      ...token,
      accessToken: data.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
      refreshToken: data.refresh_token ?? token.refreshToken,
    }
  } catch {
    return { ...token, error: "RefreshTokenError" }
  }
}

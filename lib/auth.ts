import NextAuth from "next-auth"
import Spotify from "next-auth/providers/spotify"

const SPOTIFY_SCOPES = [
  "user-top-read",
  "user-read-recently-played",
  "playlist-modify-private",
  "playlist-modify-public",
].join(" ")

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Spotify({
      clientId: process.env.SPOTIFY_CLIENT_ID!,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
      authorization: {
        params: { scope: SPOTIFY_SCOPES },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // On first login, store Spotify tokens and profile in JWT
      if (account && profile) {
        token.spotifyId = profile.id
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        token.expiresAt = account.expires_at
        token.displayName = (profile as any).display_name
        token.avatarUrl = (profile as any).images?.[0]?.url ?? null
      }
      // Refresh token if expired
      if (Date.now() < (token.expiresAt as number) * 1000) {
        return token
      }
      return refreshSpotifyToken(token)
    },
    async session({ session, token }) {
      session.user.spotifyId = token.spotifyId as string
      session.user.accessToken = token.accessToken as string
      session.user.displayName = token.displayName as string
      session.user.avatarUrl = token.avatarUrl as string | null
      session.error = token.error as string | undefined
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

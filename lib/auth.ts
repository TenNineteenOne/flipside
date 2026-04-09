import NextAuth from "next-auth"

const SPOTIFY_SCOPES = [
  "user-top-read",
  "user-read-recently-played",
  "user-read-private",
  "user-library-modify",
  "playlist-modify-private",
  "playlist-modify-public",
].join(" ")

// Define Spotify as a plain OAuth provider to bypass the next-auth v5 beta
// Spotify() helper which ignores authorization overrides and only uses the
// default "user-read-email" scope regardless of what you pass.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpotifyProvider: any = {
  id: "spotify",
  name: "Spotify",
  type: "oauth",
  authorization: {
    url: "https://accounts.spotify.com/authorize",
    params: { scope: SPOTIFY_SCOPES, show_dialog: true },
  },
  token: "https://accounts.spotify.com/api/token",
  userinfo: "https://api.spotify.com/v1/me",
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  profile(profile: { id: string; display_name: string | null; email: string; images: Array<{ url: string }> | null }) {
    return {
      id: profile.id,
      name: profile.display_name ?? profile.id,
      email: profile.email,
      image: profile.images?.[0]?.url ?? null,
    }
  },
  style: { brandColor: "#1db954" },
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  providers: [
    SpotifyProvider,
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
          displayName: (profile as { display_name?: string }).display_name,
          avatarUrl: (profile as { images?: Array<{ url: string }> }).images?.[0]?.url ?? null,
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

async function refreshSpotifyToken(token: import("next-auth/jwt").JWT) {
  try {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken as string,
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

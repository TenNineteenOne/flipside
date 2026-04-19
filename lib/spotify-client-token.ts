/**
 * Server-only helper. Fetches a Spotify Client Credentials access token and
 * caches it in memory until 60 seconds before expiry. This token is used for
 * server-side Spotify API calls that don't require a user (artist search,
 * recommendations seed). It reuses the existing SPOTIFY_CLIENT_ID and
 * SPOTIFY_CLIENT_SECRET env vars — no additional configuration needed.
 */

let cachedToken: string | null = null
let tokenExpiresAt = 0
let inFlight: Promise<string | null> | null = null

async function fetchToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) {
    console.error("[spotify-client-token] Failed to fetch client credentials token:", res.status)
    return null
  }

  const data = await res.json()
  cachedToken = data.access_token as string
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000
  return cachedToken
}

export async function getSpotifyClientToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken
  if (inFlight) return inFlight

  inFlight = fetchToken().finally(() => {
    inFlight = null
  })
  return inFlight
}

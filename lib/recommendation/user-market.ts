/**
 * User-market lookup with DB caching.
 *
 * The user's Spotify market (country code) basically never changes, so we
 * cache it in the `users.market` column. This eliminates a Spotify call on
 * every lazy track fetch.
 *
 * Designed to NEVER throw — always returns a valid market string. On any
 * failure, falls back to "US".
 */

export interface MarketDeps {
  /** Read user's cached market from DB. Returns null if unset/missing. */
  readMarket: (spotifyId: string) => Promise<string | null>
  /** Persist a fetched market to DB. Failures are swallowed. */
  writeMarket: (spotifyId: string, market: string) => Promise<void>
  /** Fetch market live from Spotify. */
  fetchMarket: () => Promise<string>
}

export async function getOrFetchUserMarket(
  spotifyId: string,
  deps: MarketDeps
): Promise<string> {
  try {
    const cached = await deps.readMarket(spotifyId)
    if (cached) {
      console.log(`[market-cache] source=db market=${cached}`)
      return cached
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[market-cache] read-throw err="${msg}"`)
  }

  let market = "US"
  try {
    market = await deps.fetchMarket()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[market-cache] fetch-fail err="${msg}"`)
    return "US"
  }

  console.log(`[market-cache] source=spotify market=${market}`)
  try {
    await deps.writeMarket(spotifyId, market)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[market-cache] write-throw err="${msg}"`)
  }
  return market
}

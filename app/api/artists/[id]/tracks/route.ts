import { type NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { getAccessToken } from "@/lib/get-access-token"
import { musicProvider } from "@/lib/music-provider/provider"
import { createServiceClient } from "@/lib/supabase/server"
import { handleTracksRequest } from "@/lib/recommendation/tracks-handler"
import { getOrFetchUserMarket } from "@/lib/recommendation/user-market"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth()
  const accessToken = await getAccessToken(req)
  const { id } = await params
  const spotifyId = session?.user?.spotifyId ?? null

  const supabase = createServiceClient()

  return handleTracksRequest(
    { spotifyId, accessToken, artistId: id },
    {
      musicProvider,
      getMarket: async () => {
        if (!spotifyId || !accessToken) return "US"
        return getOrFetchUserMarket(spotifyId, {
          readMarket: async (sid) => {
            const { data } = await supabase
              .from("users")
              .select("market")
              .eq("spotify_id", sid)
              .maybeSingle()
            return (data?.market as string | null | undefined) ?? null
          },
          writeMarket: async (sid, market) => {
            await supabase.from("users").update({ market }).eq("spotify_id", sid)
          },
          fetchMarket: () => musicProvider.getUserMarket(accessToken),
        })
      },
    }
  )
}

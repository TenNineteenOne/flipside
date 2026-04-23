import { auth } from "@/lib/auth"
import { createServiceClient } from "@/lib/supabase/server"
import { apiError, apiUnauthorized, dbError } from "@/lib/errors"
import { enforceSameOrigin } from "@/lib/csrf"
import { isValidSpotifyId } from "@/lib/spotify-ids"

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ artistId: string }> }
): Promise<Response> {
  const blocked = enforceSameOrigin(request)
  if (blocked) return blocked
  const session = await auth()
  if (!session?.user?.id) return apiUnauthorized()

  const userId = session.user.id
  const { artistId } = await params

  if (!isValidSpotifyId(artistId)) return apiError("Invalid artist ID", 400)

  const supabase = createServiceClient()

  const { error: rpcError } = await supabase.rpc("rpc_delete_feedback", {
    p_user_id: userId,
    p_artist_id: artistId,
  })

  if (rpcError) return dbError(rpcError, "feedback/delete-rpc")

  return new Response(null, { status: 204 })
}

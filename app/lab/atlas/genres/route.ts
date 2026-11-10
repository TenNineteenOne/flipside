import { atlasGenres } from "@/components/lab/atlas/data.server"

// Built once: the 3.1 MB hierarchy reduced to a columnar payload the canvas can draw directly.
export const dynamic = "force-static"

export function GET() {
  return Response.json(atlasGenres(), { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } })
}

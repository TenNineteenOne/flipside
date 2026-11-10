import { FeedClient } from "@/components/feed/feed-client"
import { previewArtists } from "@/lib/dev-preview/fixtures"

/**
 * The production feed exactly as app/(app)/feed/page.tsx renders it, with fixture artists.
 * `?start=N` starts with only the first N (the fetch stub then serves the rest in batches).
 */
export default async function FeedPreview({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start } = await searchParams
  const n = start === undefined ? previewArtists.length : Math.max(1, Number(start) || 1)
  return <FeedClient recommendations={previewArtists.slice(0, n)} musicPlatform="spotify" signalCount={0} />
}

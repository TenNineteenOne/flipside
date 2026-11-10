import { FeedClient } from "@/components/feed/feed-client"
import { previewArtists } from "@/lib/dev-preview/fixtures"

/** The production feed exactly as app/(app)/feed/page.tsx renders it, with fixture artists. */
export default function FeedPreview() {
  return <FeedClient recommendations={previewArtists} musicPlatform="spotify" signalCount={0} />
}

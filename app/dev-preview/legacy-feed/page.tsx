import { FeedClient } from "@/components/feed/feed-client"
import { previewArtists } from "@/lib/dev-preview/fixtures"

/** The current production feed, unchanged, inside the new shell. */
export default function LegacyFeedPreview() {
  return <FeedClient recommendations={previewArtists} musicPlatform="spotify" signalCount={0} />
}

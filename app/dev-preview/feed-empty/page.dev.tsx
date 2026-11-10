import { RecommendationsLoader } from "@/components/feed/recommendations-loader"

/** What app/(app)/feed/page.tsx renders when there are no recommendations yet. */
export default function FeedEmptyPreview() {
  return <RecommendationsLoader />
}

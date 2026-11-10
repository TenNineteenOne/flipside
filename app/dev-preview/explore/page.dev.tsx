import { ExploreClient } from "@/components/explore/explore-client"
import { SUPPORTED_PLATFORMS, type MusicPlatform } from "@/lib/music-links"
import { PREVIEW_CHALLENGE, PREVIEW_GENERATED_AT, previewRails } from "@/lib/dev-preview/explore-fixtures"
import { ExploreStub } from "./explore-stub"

/**
 * The production Explore client exactly as app/(app)/explore/page.tsx renders it, with fixture rails.
 * `?adventurous=1` starts with Adventurous on, `?cold=1` paints with no cached rails (cold start: the
 * client POSTs generate and polls), `?challenge=done|none` the completed / missing weekly challenge,
 * `?gen=429|500` the generate route's cooldown / failure answers (see explore-stub.tsx),
 * `?platform=apple_music|youtube_music` the listener's music platform (default spotify).
 */
export default async function ExplorePreview({
  searchParams,
}: {
  searchParams: Promise<{ adventurous?: string; cold?: string; challenge?: string; platform?: string }>
}) {
  const { adventurous: adv, cold: c, challenge, platform: p } = await searchParams
  const platform = SUPPORTED_PLATFORMS.includes(p as MusicPlatform) ? (p as MusicPlatform) : "spotify"
  const adventurous = adv === "1"
  const cold = c === "1"
  // Streams in a moment after the rails, like the real page's unawaited challenge promise.
  const challengePromise = new Promise<typeof PREVIEW_CHALLENGE | null>((resolve) =>
    setTimeout(
      () =>
        resolve(
          challenge === "none"
            ? null
            : challenge === "done"
              ? { ...PREVIEW_CHALLENGE, progress: 5, completed: true }
              : PREVIEW_CHALLENGE,
        ),
      300,
    ),
  )
  return (
    <>
      <ExploreStub />
      <ExploreClient
        rails={previewRails({ adventurous, generation: 0, cold })}
        musicPlatform={platform}
        adventurous={adventurous}
        initialSavedIds={[]}
        challengePromise={challengePromise}
        generatedAt={cold ? null : PREVIEW_GENERATED_AT}
        coldStart={cold}
      />
    </>
  )
}

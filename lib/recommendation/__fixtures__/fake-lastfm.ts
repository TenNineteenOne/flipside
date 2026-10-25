/**
 * In-memory fake of the Last.fm adapter (`@/lib/lastfm`) for the engine
 * integration tests: one seam replacing the old provider + lastfm-cache mocks.
 *
 *   vi.mock("@/lib/lastfm", async () => ({
 *     lastfm: (await import("./__fixtures__/fake-lastfm")).createFakeLastfm(),
 *   }))
 */
import type { ArtistEnrichment, Lastfm, SimilarArtistRef } from "@/lib/lastfm"

export interface FakeLastfm extends Lastfm {
  /** seed name → getSimilar refs (default: none). */
  similars: Map<string, SimilarArtistRef[]>
  /** When true, similarArtists throws (drives a rail failure). */
  similarThrows: boolean
  /** name_lower → getInfo (null = genuine not-found). Default: enriched indie/30. */
  enrichment: Map<string, ArtistEnrichment | null>
  /** tag.gettopartists answer (default: none). */
  tags: (tag: string, limit: number) => string[]
  calls: { enrich: string[]; similar: string[] }
  reset(): void
}

export function createFakeLastfm(): FakeLastfm {
  const fake: FakeLastfm = {
    similars: new Map(),
    similarThrows: false,
    enrichment: new Map(),
    tags: () => [],
    calls: { enrich: [], similar: [] },
    reset() {
      fake.similars.clear()
      fake.similarThrows = false
      fake.enrichment.clear()
      fake.tags = () => []
      fake.calls = { enrich: [], similar: [] }
    },
    hasKey: () => true,
    async tagTopArtists(tag, limit = 20) {
      return fake.tags(tag, limit)
    },
    async similarArtists(name) {
      fake.calls.similar.push(name)
      if (fake.similarThrows) throw new Error("simulated Last.fm getSimilar failure")
      return fake.similars.get(name) ?? []
    },
    async artistInfo(name) {
      fake.calls.enrich.push(name)
      const key = name.toLowerCase()
      return fake.enrichment.has(key) ? fake.enrichment.get(key)! : { genres: ["indie"], popularity: 30 }
    },
    async searchArtists() {
      return []
    },
    async userArtistNames() {
      return []
    },
  }
  return fake
}

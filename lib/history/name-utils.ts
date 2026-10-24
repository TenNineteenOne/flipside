// Moved to the artist-identity module. Kept for importers outside package B
// (lib/music-provider/lastfm-search.ts, app/api/onboarding/search/route.ts).
export {
  stringSimilarity,
  SIMILARITY_THRESHOLD,
  artistNameKey as normalizeArtistName,
} from "@/lib/artist-identity/name-key"

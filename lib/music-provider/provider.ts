import { SpotifyProvider } from "./spotify-provider"
import type { MusicProvider } from "./index"

// Single shared instance — stateless, safe to reuse
export const musicProvider: MusicProvider = new SpotifyProvider()

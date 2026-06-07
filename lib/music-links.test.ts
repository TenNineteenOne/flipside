import { describe, it, expect } from "vitest"
import { getArtistLink, getShareableArtistLink } from "./music-links"

const SPOTIFY_ID = "4Z8W4fKeB5YxbusRsdQVPb"

describe("getArtistLink", () => {
  it("spotify: direct artist URL when spotifyId is present", () => {
    expect(getArtistLink("spotify", { artistId: "uuid", spotifyId: SPOTIFY_ID, artistName: "Radiohead" })).toBe(
      `https://open.spotify.com/artist/${SPOTIFY_ID}`,
    )
  })

  it("spotify: zero-API search-URL fallback when spotifyId is absent", () => {
    expect(getArtistLink("spotify", { artistId: "uuid", spotifyId: null, artistName: "Boards of Canada" })).toBe(
      "https://open.spotify.com/search/Boards%20of%20Canada",
    )
    // undefined behaves the same as null
    expect(getArtistLink("spotify", { artistId: "uuid", artistName: "Boards of Canada" })).toBe(
      "https://open.spotify.com/search/Boards%20of%20Canada",
    )
  })

  it("apple_music: resolver path when spotifyId present, search fallback when absent", () => {
    expect(getArtistLink("apple_music", { artistId: "uuid", spotifyId: SPOTIFY_ID, artistName: "Radiohead" })).toBe(
      `/api/open/apple_music/${SPOTIFY_ID}?name=Radiohead`,
    )
    expect(getArtistLink("apple_music", { artistId: "uuid", spotifyId: null, artistName: "Radiohead" })).toBe(
      "https://music.apple.com/search?term=Radiohead",
    )
  })

  it("youtube_music: always the search URL", () => {
    expect(getArtistLink("youtube_music", { artistId: "uuid", spotifyId: SPOTIFY_ID, artistName: "Radiohead" })).toBe(
      "https://music.youtube.com/search?q=Radiohead",
    )
  })

  it("encodes special characters in the artist name", () => {
    const link = getArtistLink("spotify", { artistId: "uuid", spotifyId: null, artistName: "AC/DC & Friends" })
    expect(link).toBe("https://open.spotify.com/search/AC%2FDC%20%26%20Friends")
  })
})

describe("getShareableArtistLink", () => {
  it("spotify: direct URL with id, search fallback without", () => {
    expect(getShareableArtistLink("spotify", { artistId: "uuid", spotifyId: SPOTIFY_ID, artistName: "X" })).toBe(
      `https://open.spotify.com/artist/${SPOTIFY_ID}`,
    )
    expect(getShareableArtistLink("spotify", { artistId: "uuid", spotifyId: null, artistName: "X" })).toBe(
      "https://open.spotify.com/search/X",
    )
  })

  it("apple_music: always the universal Apple search URL (not the local resolver path)", () => {
    expect(getShareableArtistLink("apple_music", { artistId: "uuid", spotifyId: SPOTIFY_ID, artistName: "Radiohead" })).toBe(
      "https://music.apple.com/search?term=Radiohead",
    )
  })

  it("youtube_music: the search URL", () => {
    expect(getShareableArtistLink("youtube_music", { artistId: "uuid", spotifyId: null, artistName: "Radiohead" })).toBe(
      "https://music.youtube.com/search?q=Radiohead",
    )
  })
})

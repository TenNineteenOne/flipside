#!/usr/bin/env node
// VERIFICATION SCAFFOLDING. Seeds the throwaway DB with the rows the pages read, for journeys that
// only need existing data (there is no LASTFM_API_KEY here, so the engine cannot generate a feed).
// Run through `fv seed <username> [feed|history|saved|all]`. The account must already exist: create
// it through the real /sign-in page first. Re-running replaces that user's seeded rows.
//
// Shapes mirror what POST /api/recommendations/generate writes (lib/cards/feed-cards.ts reads
// artist_data.{id,name,genres,imageUrl,popularity,topTracks,artist_color} and why.{sourceArtists,genres});
// feedback / seen_at / skip_at mirror rpc_record_feedback_v2 (migration 0036).
//
// Previews and artwork are real: fetched once from the keyless iTunes Search API and cached in
// ~/.cache/flipside-verify/itunes-cache.json. An artist iTunes cannot answer for is seeded without
// tracks and reported; the Feed drops cards without a playable preview, exactly as in production.
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const { Client } = require("pg")

const HOME = process.env.FLIPSIDE_VERIFY_HOME || path.join(require("node:os").homedir(), ".cache/flipside-verify")
const CACHE = path.join(HOME, "itunes-cache.json")

// name, genre, popularity. Six start with "The " so the onboarding search for "the " gets >= 5
// cache hits and never needs Last.fm (app/api/onboarding/search: CACHE_SUFFICIENT = 5).
const FEED = [
  ["The Beatles", "rock", 88], ["The Cure", "post-punk", 79], ["The Smiths", "indie", 78], ["The Clash", "punk", 74],
  ["The Kinks", "rock", 70], ["The National", "indie rock", 68], ["Radiohead", "alternative", 85], ["Portishead", "trip-hop", 66],
  ["Massive Attack", "trip-hop", 71], ["Talking Heads", "new wave", 76], ["Cocteau Twins", "dream pop", 62], ["Slowdive", "shoegaze", 64],
]
// History: name, genre, popularity, state
const HISTORY = [
  ["Joy Division", "post-punk", 72, "thumbs_up"], ["New Order", "new wave", 73, "thumbs_up"],
  ["Pixies", "alternative", 75, "thumbs_down"], ["Sonic Youth", "noise rock", 63, "thumbs_down"],
  ["Stereolab", "art pop", 55, "skip"], ["Broadcast", "art pop", 49, "skip"],
  ["Mogwai", "post-rock", 58, "dismissed"], ["Low", "slowcore", 50, "saved"],
]
const HISTORY_FILLER = 55 // seen-only rows named "Verify Filler NN", older than the above: page 2 for "Load more"
const SAVED = ["Low", "Radiohead", "Slowdive"] // Radiohead + Slowdive are also unrated Feed cards

async function itunes(name, cache) {
  if (cache[name]) return cache[name]
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=song&attribute=artistTerm&limit=5`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const json = await res.json()
    const tracks = (json.results || [])
      .filter((t) => t.previewUrl && (t.artistName || "").toLowerCase() === name.toLowerCase())
      .slice(0, 3)
      .map((t) => ({
        id: String(t.trackId), spotifyTrackId: null, name: t.trackName, previewUrl: t.previewUrl,
        durationMs: t.trackTimeMillis || 30000, albumName: t.collectionName || "",
        albumImageUrl: (t.artworkUrl100 || "").replace("100x100bb", "600x600bb") || null, source: "itunes",
      }))
    if (tracks.length) cache[name] = tracks
    return tracks
  } catch (e) {
    console.error(`iTunes lookup failed for ${name}: ${e.message}`)
    return []
  }
}

async function main() {
  const [username, what = "all"] = process.argv.slice(2)
  const want = (k) => what === "all" || what === k
  const hash = crypto.createHmac("sha256", process.env.USERNAME_HMAC_SECRET).update(username.trim().toLowerCase()).digest("hex")
  const db = new Client({ host: "127.0.0.1", port: Number(process.env.FV_PG_PORT), user: "postgres", database: "postgres" })
  await db.connect()
  try {
    const u = await db.query("select id from users where username_hash = $1", [hash])
    if (!u.rows.length) throw new Error(`no account "${username}" in this run's database: create it through /sign-in first`)
    const userId = u.rows[0].id
    const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {}

    // One artists row per name (the app's doorway also reuses the name_lower row).
    async function artist(name, genre, popularity, withTracks) {
      const tracks = withTracks ? await itunes(name, cache) : []
      const image = tracks[0]?.albumImageUrl ?? null
      let r = await db.query("select id from artists where name_lower = lower($1) order by created_at limit 1", [name])
      if (!r.rows.length) {
        r = await db.query(
          "insert into artists (name, name_lower, genres, popularity, image_url) values ($1, lower($1), $2, $3, $4) returning id",
          [name, [genre], popularity, image])
      }
      const id = r.rows[0].id
      return { id, name, genres: [genre], imageUrl: image, popularity, topTracks: tracks }
    }
    async function rec(a, score, seenAt, skipAt) {
      await db.query("delete from recommendation_cache where user_id = $1 and artist_id = $2", [userId, a.id])
      await db.query(
        `insert into recommendation_cache (user_id, artist_id, artist_data, score, why, source, seen_at, skip_at, expires_at)
         values ($1, $2, $3, $4, $5, 'verify-seed', $6, $7, now() + interval '7 days')`,
        [userId, a.id, JSON.stringify(a), score, JSON.stringify({ sourceArtists: ["Verify Seed"], genres: a.genres, friendBoost: [] }), seenAt, skipAt])
    }
    const report = []

    if (want("feed")) {
      let n = 0
      for (const [i, [name, genre, pop]] of FEED.entries()) {
        const a = await artist(name, genre, pop, true)
        await db.query("delete from feedback where user_id = $1 and artist_id = $2", [userId, a.id])
        await rec(a, 1 - i * 0.01, null, null)
        if (a.topTracks.length) n++
        else report.push(`WARNING no iTunes preview for ${name}: the Feed will drop this card`)
      }
      report.push(`feed: ${FEED.length} unseen rows, ${n} with playable previews`)
    }

    if (want("history")) {
      const all = [...HISTORY, ...Array.from({ length: HISTORY_FILLER }, (_, i) => [`Verify Filler ${String(i + 1).padStart(2, "0")}`, "filler", 0, "skip"])]
      for (const [i, [name, genre, pop, state]] of all.entries()) {
        const a = await artist(name, genre, pop, i < HISTORY.length)
        const seenAt = new Date(Date.now() - (i + 1) * 60_000).toISOString() // newest first, one minute apart
        await rec(a, 0.5, seenAt, state === "dismissed" ? seenAt : null)
        await db.query("delete from feedback where user_id = $1 and artist_id = $2", [userId, a.id])
        if (state === "thumbs_up" || state === "thumbs_down") {
          await db.query("insert into feedback (user_id, artist_id, signal) values ($1, $2, $3)", [userId, a.id, state])
        }
      }
      report.push(`history: ${HISTORY.length} named rows (2 liked, 2 passed, 2 skipped, 1 dismissed, 1 saved after the saved seed) + ${HISTORY_FILLER} filler`)
    }

    if (want("saved")) {
      await db.query("delete from saves where user_id = $1", [userId])
      for (const name of SAVED) {
        const r = await db.query("select id from artists where name_lower = lower($1) order by created_at limit 1", [name])
        if (!r.rows.length) { report.push(`WARNING saved: ${name} has no artists row yet (seed feed/history first)`); continue }
        await db.query("insert into saves (user_id, artist_id, artist_name) values ($1, $2, $3)", [userId, r.rows[0].id, name])
      }
      report.push(`saved: ${SAVED.join(", ")}`)
    }

    fs.writeFileSync(CACHE, JSON.stringify(cache))
    console.log(`user ${userId}\n${report.join("\n")}`)
    if (report.some((l) => l.startsWith("WARNING"))) process.exitCode = 3
  } finally {
    await db.end()
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })

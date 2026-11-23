// One user, one artist, the real code: the client store, the route handlers,
// the SQL functions and the functions the pages read with.
import { createArtistFeedback, createArtistSaves, type ArtistFeedback } from "@/lib/client/artist-signals"
import { hasFeedbackRow } from "@/components/history/history-client"
import { getUnseenRecommendations } from "@/lib/recommendation/feed-query"
import { getHistoryPage } from "@/lib/history/query"
import { loadExclusions } from "@/lib/recommendation/exclusions"
import { FEED_PLAY_THRESHOLD } from "@/lib/recommendation/types"
import { POST as feedbackPost } from "@/app/api/feedback/route"
import { DELETE as feedbackDelete } from "@/app/api/feedback/[artistId]/route"
import { DELETE as dismissDelete } from "@/app/api/dismiss/[artistId]/route"
import { POST as savesPost, DELETE as savesDelete } from "@/app/api/saves/route"
import { createServiceClient, sql, statements } from "./supabase-pg"
import type { Row } from "./tables"

export const USER = "00000000-0000-4000-8000-000000000001"
export const ARTIST = "11111111-1111-4111-8111-111111111111"
const ORIGIN = "https://flipside.test"

/** Model signal names <-> the app's. "U" is the store's undefined. */
export const APP = { up: "thumbs_up", down: "thumbs_down", skip: "skip", dismissed: "dismissed" } as const
export const MODEL: Record<string, string> = { thumbs_up: "up", thumbs_down: "down", skip: "skip", dismissed: "dismissed" }

/** Put the rows in a model state. `softDeleted` keeps a soft-deleted feedback row when fb is "none". */
export async function setState([fb, seen, skip, saved]: Row, softDeleted?: "up" | "down") {
  await sql("insert into users (id) values ($1) on conflict do nothing", [USER])
  await sql("insert into artists (id, name, name_lower) values ($1, 'Test Artist', 'test artist') on conflict do nothing", [ARTIST])
  for (const t of ["feedback", "saves", "recommendation_cache", "user_challenges"])
    await sql(`delete from ${t} where user_id = $1`, [USER])
  await sql(
    `insert into recommendation_cache (user_id, artist_id, artist_data, expires_at, seen_at, skip_at)
     values ($1, $2, $3, now() + interval '7 days', case when $4 then now() end, case when $5 then now() end)`,
    [USER, ARTIST, JSON.stringify({ id: ARTIST, name: "Test Artist", genres: [], imageUrl: null, popularity: 10 }), seen, skip],
  )
  const signal = fb !== "none" ? fb : softDeleted
  if (signal)
    await sql("insert into feedback (user_id, artist_id, signal, deleted_at) values ($1, $2, $3, case when $4 then now() end)", [
      USER, ARTIST, APP[signal], fb === "none",
    ])
  if (saved) await sql("insert into saves (user_id, artist_id) values ($1, $2)", [USER, ARTIST])
  statements.length = 0
}

/** The rows as a model state. */
export async function readState(): Promise<Row> {
  const [r] = await sql(
    `select (select signal from feedback where user_id = $1 and artist_id = $2 and deleted_at is null) as fb,
            (select seen_at is not null from recommendation_cache where user_id = $1 and artist_id = $2) as seen,
            (select skip_at is not null from recommendation_cache where user_id = $1 and artist_id = $2) as skip,
            exists (select 1 from saves where user_id = $1 and artist_id = $2) as saved`,
    [USER, ARTIST],
  )
  return [r.fb ? (MODEL[r.fb as string] as Row[0]) : "none", r.seen as boolean, r.skip as boolean, r.saved as boolean]
}

/** What the pages would show after a reload, through the functions the pages use. */
export async function pages() {
  const supabase = createServiceClient() as never
  const queue = await getUnseenRecommendations(supabase, USER, { limit: 20, undergroundMode: false })
  const { history } = await getHistoryPage(supabase, USER, { offset: 0, limit: 50 })
  const entry = history.find((h) => h.artist_id === ARTIST)
  const exclusions = await loadExclusions(supabase, USER, { playThreshold: FEED_PLAY_THRESHOLD, nameFallback: false, liked: true })
  return {
    inQueue: queue.some((r) => r.artist_id === ARTIST),
    inHistory: !!entry,
    /** History's signal for the row: thumbs_up, thumbs_down, dismissed or skip ("Skipped"). */
    historySignal: entry?.signal,
    bookmarked: entry?.bookmarked,
    /** Why the engine would refuse to recommend the artist again, or null. */
    excluded: exclusions.reason({ id: ARTIST, name: "Test Artist" }),
  }
}

/** The model's name for an HTTP request the client sends. */
export function requestName(url: string, init?: RequestInit): string {
  const method = init?.method ?? "GET"
  if (url === "/api/feedback" && method === "POST")
    return { thumbs_up: "postUp", thumbs_down: "postDown", skip: "postSkip" }[JSON.parse(String(init!.body)).signal as string]!
  if (url.startsWith("/api/feedback/") && method === "DELETE") return "delFeedback"
  if (url.startsWith("/api/dismiss/") && method === "DELETE") return "delDismiss"
  if (url === "/api/saves") return method === "POST" ? "save" : "delSave"
  throw new Error(`unexpected request ${method} ${url}`)
}

/** Hand a client request to the real route handler. */
export async function route(url: string, init?: RequestInit): Promise<Response> {
  const request = () =>
    new Request(ORIGIN + url, { method: init?.method, body: init?.body, headers: { origin: ORIGIN, host: "flipside.test", "content-type": "application/json" } })
  const params = { params: Promise.resolve({ artistId: decodeURIComponent(url.split("/").pop()!) }) }
  switch (requestName(url, init)) {
    case "delFeedback": return feedbackDelete(request(), params)
    case "delDismiss": return dismissDelete(request(), params)
    case "save": return savesPost(request())
    case "delSave": return savesDelete(request())
    default: return feedbackPost(request())
  }
}

/** Send one model request straight to its route (no client). */
export function send(name: string): Promise<Response> {
  const body = (o: object) => ({ method: "POST", body: JSON.stringify({ artistId: ARTIST, ...o }) })
  switch (name) {
    case "postUp": return route("/api/feedback", body({ signal: "thumbs_up" }))
    case "postDown": return route("/api/feedback", body({ signal: "thumbs_down" }))
    case "postSkip": return route("/api/feedback", body({ signal: "skip" }))
    case "delFeedback": return route(`/api/feedback/${ARTIST}`, { method: "DELETE" })
    case "delDismiss": return route(`/api/dismiss/${ARTIST}`, { method: "DELETE" })
    case "save": return route("/api/saves", body({}))
    case "delSave": return route("/api/saves", { ...body({}), method: "DELETE" })
    default: throw new Error(`no route for ${name}`)
  }
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

/**
 * One browser tab: the real feedback and saves stores over a network the test
 * steps by hand, so each model step is one call here.
 *   ok   the server applies the request and the tab gets the answer
 *   lost the server applies it, the tab sees a failure
 *   fail the server never sees it
 */
export function openTab() {
  const waiting: { url: string; init?: RequestInit; resolve: (r: Response) => void; reject: (e: Error) => void }[] = []
  const fetchImpl = ((url: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => waiting.push({ url: String(url), init, resolve, reject }))) as typeof fetch
  const toast = { error: () => {} }
  const feedback = createArtistFeedback({ fetchImpl, toast })
  const saves = createArtistSaves({ fetchImpl, toast })
  return {
    feedback,
    saves,
    /** The verdict the tab shows, in model words. */
    shows: () => { const s = feedback.store.get(ARTIST); return s === undefined ? "U" : MODEL[s] },
    /** Let the server handle this tab's oldest waiting request; returns the request's model name. */
    async server(outcome: "ok" | "lost" | "fail" = "ok") {
      await settle()
      const w = waiting.shift()
      if (!w) throw new Error("no request is waiting in this tab")
      if (outcome === "fail") w.reject(new Error("network"))
      else {
        const res = await route(w.url, w.init)
        if (!res.ok && res.status !== 204) throw new Error(`${w.url} answered ${res.status}`)
        if (outcome === "ok") w.resolve(res)
        else w.reject(new Error("answer lost"))
      }
      await settle()
      return requestName(w.url, w.init)
    },
    waiting: async () => { await settle(); return waiting.length },
  }
}

/**
 * History's "Return to feed": components/history/history-client.tsx handleUndo.
 * That line lives inside a React component, so it is repeated here;
 * conformance.check.ts fails if the source line changes.
 */
export const RETURN_TO_FEED_SOURCE =
  "const ok = (!hasFeedbackRow(signal) || (await removeSignal(artistId))) && (await dismiss(artistId))"
export const returnToFeed = async (fb: ArtistFeedback, signal: string) =>
  (!hasFeedbackRow(signal) || (await fb.removeSignal(ARTIST))) && (await fb.dismiss(ARTIST))

/** The signal a History row shows: the store's, else the one it was loaded with (history-client.tsx `shown`). */
export const historyShows = (fb: ArtistFeedback, loaded: string) => fb.store.get(ARTIST) ?? loaded

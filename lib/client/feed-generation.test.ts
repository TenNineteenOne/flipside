import { describe, it, expect, vi } from "vitest"
import {
  classifyGenerate,
  createFeedGeneration,
  loaderAction,
  pollRecsUntilReady,
  postGenerate,
  type ToastLike,
} from "./feed-generation"

function res(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response
}

function makeToast() {
  return Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) as unknown as ToastLike & {
    error: ReturnType<typeof vi.fn>
    success: ReturnType<typeof vi.fn>
  }
}

const COOLDOWN = { error: "Please wait before generating more recommendations" }
const QUEUE = { error: "Your discovery queue is full. Please review some artists before generating more." }

describe("classifyGenerate", () => {
  it.each([
    [200, { count: 20 }, "ready"],
    [200, {}, "ready"],
    [200, { count: 5, pending: true }, "ready"],
    [200, { count: 0, pending: true }, "in-flight"],
    [200, { count: 0 }, "empty"],
    [401, {}, "unauthorized"],
    [429, COOLDOWN, "cooldown"],
    [429, QUEUE, "queue-full"],
    [503, { error: "Music service temporarily unavailable" }, "unavailable"],
    [500, {}, "error"],
  ] as const)("%i %j → %s", (status, body, kind) => {
    expect(classifyGenerate(status, body)).toBe(kind)
  })

  it("postGenerate turns a network failure into status 0", async () => {
    const r = await postGenerate(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    expect(r).toMatchObject({ kind: "error", status: 0, ok: false, error: "Failed to fetch" })
  })
})

describe("loaderAction (RecommendationsLoader)", () => {
  const run = async (status: number, body: object = {}) => loaderAction(await postGenerate(vi.fn().mockResolvedValue(res(status, body))))

  it("refreshes on ready and on a full queue", async () => {
    expect(await run(200, { count: 3 })).toEqual({ action: "refresh" })
    expect(await run(429, QUEUE)).toEqual({ action: "refresh" })
  })
  it("polls on cooldown and on count:0 + pending", async () => {
    expect(await run(429, COOLDOWN)).toEqual({ action: "poll" })
    expect(await run(200, { count: 0, pending: true })).toEqual({ action: "poll" })
  })
  it("errors with the server text, the no-artists copy, or the default", async () => {
    expect(await run(503, { error: "Music service temporarily unavailable" })).toEqual({ action: "error", message: "Music service temporarily unavailable" })
    expect((await run(200, { count: 0 })).action).toBe("error")
    expect(await run(401)).toEqual({ action: "error", message: "Generation failed" })
  })
  it("#175 F13: a thrown POST (iOS backgrounding) polls instead of surfacing the raw message", async () => {
    expect(loaderAction(await postGenerate(vi.fn().mockRejectedValue(new TypeError("Load failed"))))).toEqual({ action: "poll" })
  })
})

describe("#175 F13 pollRecsUntilReady", () => {
  const deps = (fetchImpl: ReturnType<typeof vi.fn>) => {
    let t = 0
    return { deadline: 10_000, intervalMs: 2500, isCancelled: () => false, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => t, sleep: async (ms: number) => { t += ms } }
  }
  it("a thrown poll fetch is transient: keeps polling and reaches ready", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValue(res(200, { recommendations: [{}] }))
    expect(await pollRecsUntilReady(deps(fetchImpl))).toBe("ready")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it("only times out once the deadline passes", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Load failed"))
    expect(await pollRecsUntilReady(deps(fetchImpl))).toBe("timeout")
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })
})

describe("createFeedGeneration.requestMore", () => {
  it("guards re-entry synchronously and flips generating", async () => {
    let resolve: (r: Response) => void = () => {}
    const fetchImpl = vi.fn(() => new Promise<Response>((r) => { resolve = r }))
    const changes: boolean[] = []
    const gen = createFeedGeneration({ fetchImpl, toast: makeToast(), onGeneratingChange: (g) => changes.push(g) })
    const first = gen.requestMore()
    expect(await gen.requestMore()).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    resolve(res(200, { count: 1 }))
    expect((await first)?.kind).toBe("ready")
    expect(changes).toEqual([true, false])
    expect(gen.generating).toBe(false)
  })

  it("Load more (not silent): no toast on a softened 200, raw server error on 429, nothing on 401", async () => {
    const toast = makeToast()
    const fetchImpl = vi.fn()
    const gen = createFeedGeneration({ fetchImpl, toast })

    fetchImpl.mockResolvedValueOnce(res(200, { count: 4, softenedFilters: { coldStart: true } }))
    await gen.requestMore()
    expect(toast).not.toHaveBeenCalled()

    fetchImpl.mockResolvedValueOnce(res(429, COOLDOWN))
    await gen.requestMore()
    expect(toast.error).toHaveBeenLastCalledWith(COOLDOWN.error)

    fetchImpl.mockResolvedValueOnce(res(503, {}))
    await gen.requestMore()
    expect(toast.error).toHaveBeenLastCalledWith("Generation failed")

    toast.error.mockClear()
    fetchImpl.mockResolvedValueOnce(res(401))
    expect((await gen.requestMore())?.kind).toBe("unauthorized")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("top-up (silent): no toasts on 429 or softened", async () => {
    const toast = makeToast()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(res(429, COOLDOWN))
      .mockResolvedValueOnce(res(200, { count: 2, softenedFilters: { coldStart: true } }))
    const gen = createFeedGeneration({ fetchImpl, toast })
    expect((await gen.requestMore({ silent: true }))?.ok).toBe(false)
    expect((await gen.requestMore({ silent: true }))?.ok).toBe(true)
    expect(toast).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("replace: posts ?replace=true and retries a cooldown quietly until it succeeds", async () => {
    const toast = makeToast()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(res(429, COOLDOWN))
      .mockResolvedValueOnce(res(429, COOLDOWN))
      .mockResolvedValueOnce(res(200, { count: 20 }))
    let t = 0
    const sleep = vi.fn(async (ms: number) => { t += ms })
    const gen = createFeedGeneration({ fetchImpl, toast, sleep, now: () => t })
    expect((await gen.requestMore({ replace: true }))?.kind).toBe("ready")
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/recommendations/generate?replace=true")
    expect(sleep).toHaveBeenCalledWith(3000)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("replace: gives up after the retry window and reports the cooldown once", async () => {
    const toast = makeToast()
    const fetchImpl = vi.fn(async () => res(429, COOLDOWN))
    let t = 0
    const gen = createFeedGeneration({ fetchImpl, toast, sleep: async (ms: number) => { t += ms }, now: () => t })
    expect((await gen.requestMore({ replace: true }))?.kind).toBe("cooldown")
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(2)
    expect(t).toBeGreaterThanOrEqual(35_000)
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it("release() frees the guard and the abandoned run no longer flips generating", async () => {
    const resolvers: Array<(r: Response) => void> = []
    const fetchImpl = vi.fn(() => new Promise<Response>((r) => { resolvers.push(r) }))
    const gen = createFeedGeneration({ fetchImpl, toast: makeToast() })
    const abandoned = gen.requestMore({ silent: true })
    gen.release()
    const second = gen.requestMore({ silent: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    resolvers[0](res(200, { count: 1 }))
    await abandoned
    expect(gen.generating).toBe(true) // second still in flight
    resolvers[1](res(200, { count: 1 }))
    await second
    expect(gen.generating).toBe(false)
  })

  it("#175 Y3-f/g: release() reports generating=false and silences the abandoned run's toast", async () => {
    let resolve: (r: Response) => void = () => {}
    const fetchImpl = vi.fn(() => new Promise<Response>((r) => { resolve = r }))
    const toast = makeToast()
    const changes: boolean[] = []
    const gen = createFeedGeneration({ fetchImpl, toast, onGeneratingChange: (g) => changes.push(g) })
    const run = gen.requestMore()
    gen.release()
    expect(changes).toEqual([true, false])
    resolve(res(500, { error: "boom" }))
    await run
    expect(toast.error).not.toHaveBeenCalled()
    expect(changes).toEqual([true, false])
  })
})

import { describe, it, expect } from "vitest"
import { createKeyedSerializer } from "../keyed-serializer"

describe("createKeyedSerializer", () => {
  it("runs tasks for the same key strictly in submission order", async () => {
    const run = createKeyedSerializer()
    const order: string[] = []
    const defer = <T>(label: string, value: T, delayMs: number) =>
      new Promise<T>((resolve) => {
        setTimeout(() => {
          order.push(label)
          resolve(value)
        }, delayMs)
      })

    // Submit a slow task first, then a fast task. Without serialization the
    // fast one would complete first; with it, submission order is preserved.
    const slow = run("same", () => defer("slow", 1, 20))
    const fast = run("same", () => defer("fast", 2, 1))

    await Promise.all([slow, fast])
    expect(order).toEqual(["slow", "fast"])
  })

  it("runs tasks for different keys concurrently", async () => {
    const run = createKeyedSerializer()
    const order: string[] = []
    const defer = (label: string, delayMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push(label)
          resolve()
        }, delayMs)
      })

    const a = run("a", () => defer("a-slow", 20))
    const b = run("b", () => defer("b-fast", 1))

    await Promise.all([a, b])
    // b is on a different key, so its 1ms task finishes before a's 20ms task.
    expect(order).toEqual(["b-fast", "a-slow"])
  })

  it("continues the chain even if a previous task rejects", async () => {
    const run = createKeyedSerializer()
    const order: string[] = []

    const first = run("k", async () => {
      order.push("first")
      throw new Error("boom")
    })
    const second = run("k", async () => {
      order.push("second")
      return 42
    })

    await expect(first).rejects.toThrow("boom")
    await expect(second).resolves.toBe(42)
    expect(order).toEqual(["first", "second"])
  })

  it("returns the value produced by the task", async () => {
    const run = createKeyedSerializer()
    const result = await run("x", async () => "hello")
    expect(result).toBe("hello")
  })
})

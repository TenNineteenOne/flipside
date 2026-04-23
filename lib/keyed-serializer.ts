/**
 * Returns a function that serializes async work per key: two calls with the
 * same key run strictly in order, even if the caller fires them back-to-back.
 *
 * Used for save/unsave toggles — rapid clicks on the same artist must hit the
 * server in click order, otherwise the final server state can disagree with
 * the user's last intent (e.g. DELETE arriving before POST leaves the row
 * saved when the user's last click was "unsave").
 */
export function createKeyedSerializer() {
  const chain = new Map<string, Promise<unknown>>()
  return function run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = chain.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    chain.set(
      key,
      next.finally(() => {
        if (chain.get(key) === next) chain.delete(key)
      })
    )
    return next as Promise<T>
  }
}

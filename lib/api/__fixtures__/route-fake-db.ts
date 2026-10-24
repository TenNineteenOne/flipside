/**
 * Minimal evaluating PostgREST fake for route tests (test-only).
 *
 * ponytail: covers exactly the chains the X1 routes issue — select (incl.
 * `{ count: "exact", head: true }`), update/delete/insert/upsert with an
 * optional trailing `.select()`, filters eq/is/lt/lte/gt/in/or (or terms:
 * `col.is.null`, `col.{eq,lt,lte,gt}.value`, value quotes stripped), and
 * maybeSingle/single/limit. Timestamps compare as ISO strings, which sort
 * correctly when all values are `toISOString()` output. The recommendation
 * harness fake (lib/recommendation/__fixtures__) lacks lt/lte/count.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>

export function createRouteFakeDb(initial: Record<string, Row[]> = {}, fail: Record<string, string> = {}) {
  const tables: Record<string, Row[]> = {}
  for (const k of Object.keys(initial)) tables[k] = initial[k].map((r) => ({ ...r }))
  const log: Array<{ table: string; op: string; payload?: unknown }> = []

  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    let op = "select"
    let payload: Row | Row[] | null = null
    let countMode = false
    let headMode = false
    let one: "single" | "maybe" | null = null
    let limitN: number | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cmp = (c: string, a: any, b: any) =>
      c === "eq" ? String(a) === String(b) : a == null ? false : c === "lt" ? a < b : c === "lte" ? a <= b : c === "gt" ? a > b : c === "gte" ? a >= b : false

    function run() {
      log.push({ table, op, payload })
      if (fail[table] === op || fail[table] === "*") return { data: null, error: { message: `fake ${table} ${op} failed` }, count: null }
      const t = (tables[table] ??= [])
      let rows = t.filter((r) => filters.every((f) => f(r)))
      if (limitN != null) rows = rows.slice(0, limitN)
      let out: Row[] = rows
      if (op === "update") rows.forEach((r) => Object.assign(r, payload))
      else if (op === "delete") tables[table] = t.filter((r) => !rows.includes(r))
      else if (op === "insert" || op === "upsert") {
        out = (Array.isArray(payload) ? payload : [payload!]).map((p) => ({ ...p }))
        t.push(...out)
      }
      const data = out.map((r) => ({ ...r }))
      if (one) return { data: data[0] ?? null, error: one === "single" && !data.length ? { message: "no rows" } : null }
      return { data: headMode ? null : data, error: null, count: countMode ? rows.length : null }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        countMode = opts?.count === "exact"
        headMode = !!opts?.head
        return q
      },
      insert(p: Row | Row[]) { op = "insert"; payload = p; return q },
      upsert(p: Row | Row[]) { op = "upsert"; payload = p; return q },
      update(p: Row) { op = "update"; payload = p; return q },
      delete() { op = "delete"; return q },
      eq(c: string, v: unknown) { filters.push((r) => cmp("eq", r[c], v)); return q },
      neq(c: string, v: unknown) { filters.push((r) => !cmp("eq", r[c], v)); return q },
      is(c: string, v: unknown) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q },
      lt(c: string, v: unknown) { filters.push((r) => cmp("lt", r[c], v)); return q },
      lte(c: string, v: unknown) { filters.push((r) => cmp("lte", r[c], v)); return q },
      gt(c: string, v: unknown) { filters.push((r) => cmp("gt", r[c], v)); return q },
      gte(c: string, v: unknown) { filters.push((r) => cmp("gte", r[c], v)); return q },
      in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return q },
      or(expr: string) {
        const terms = expr.split(",").map((term) => {
          const [c, o, ...rest] = term.split(".")
          const v = rest.join(".").replace(/^"(.*)"$/, "$1")
          return (r: Row) => (o === "is" && v === "null" ? r[c] == null : cmp(o, r[c], v))
        })
        filters.push((r) => terms.some((f) => f(r)))
        return q
      },
      order() { return q },
      limit(n: number) { limitN = n; return q },
      maybeSingle() { one = "maybe"; return q },
      single() { one = "single"; return q },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then(res: (v: any) => any, rej?: (e: any) => any) {
        return Promise.resolve().then(run).then(res, rej)
      },
    }
    return q
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, tables, log }
}

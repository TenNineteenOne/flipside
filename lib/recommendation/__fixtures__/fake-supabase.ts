/**
 * In-memory Supabase fake for the recommendation-pipeline integration tests.
 *
 * NOT a general-purpose Supabase mock — it implements exactly the chainable
 * query surface the two orchestrators (`buildRecommendations`,
 * `buildExploreRails`) and their helpers exercise:
 *
 *   .from(table)
 *     .select(cols)[.eq/.is/.not/.gt/.gte/.in/.or/.order/.limit][.maybeSingle/.single]
 *     .insert(row | rows)[.select(cols).single()]
 *     .upsert(rows, { onConflict, ignoreDuplicates })
 *     .update(patch).eq(col, val)
 *     .delete().eq(col, val)
 *   .rpc(name, args)   — dispatched to the `rpcs` handlers passed in (optional)
 *
 * Every builder node is a thenable (implements `.then`), so both
 * `await query` and `query.then(cb)` resolve to `{ data, error }` — matching
 * the shapes the production code destructures. Rows live in a shared
 * `Map<table, Row[]>` so writes from one `.from()` call are visible to the
 * next (the orchestrators construct fresh clients but share one DB).
 */
import { randomUUID } from "node:crypto"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>
export type Tables = Record<string, Row[]>

export interface FakeSupabase {
  /** The value returned by the mocked `createServiceClient()`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any
  /** Live view of the in-memory tables (mutated by writes). */
  tables: Tables
  /** Every executed query, in order: table, op, and the last `.in()` values. */
  queries: Array<{ table: string; op: string; in?: unknown[] }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RpcHandler = (args: any, tables: Tables) => { data?: unknown; error: { message: string } | null }

export function createFakeSupabase(
  initial: Tables = {},
  opts: {
    rpcs?: Record<string, RpcHandler>
    /** Per-table failure injection: "error" → `{ error }` result, "throw" → rejected promise. */
    fail?: Record<string, "error" | "throw">
  } = {},
): FakeSupabase {
  const queries: FakeSupabase["queries"] = []
  const tables: Tables = {}
  for (const k of Object.keys(initial)) tables[k] = initial[k].map((r) => ({ ...r }))
  const ensure = (t: string): Row[] => (tables[t] ??= [])

  function makeQuery(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payload: any = null
    let conflictCols: string[] = []
    let ignoreDuplicates = false
    let single = false
    let maybeSingle = false
    let orderSpec: { col: string; ascending: boolean } | null = null
    let limitN: number | null = null
    let inVals: unknown[] | undefined

    function matching(): Row[] {
      let rows = ensure(table).filter((r) => filters.every((f) => f(r)))
      if (orderSpec) {
        const { col, ascending } = orderSpec
        rows = [...rows].sort((a, b) => {
          const av = a[col]
          const bv = b[col]
          if (av === bv) return 0
          return (av < bv ? -1 : 1) * (ascending ? 1 : -1)
        })
      }
      if (limitN != null) rows = rows.slice(0, limitN)
      return rows
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function run(): any {
      queries.push({ table, op, in: inVals })
      const failure = opts.fail?.[table]
      if (failure === "throw") throw new Error(`fake ${table} ${op} threw`)
      if (failure === "error") return { data: null, error: { message: `fake ${table} ${op} failed` } }
      const t = ensure(table)
      if (op === "select") {
        const rows = matching()
        if (single) return { data: rows[0] ?? null, error: rows.length ? null : { message: "no rows" } }
        if (maybeSingle) return { data: rows[0] ?? null, error: null }
        return { data: rows.map((r) => ({ ...r })), error: null }
      }
      if (op === "insert") {
        if (Array.isArray(payload)) {
          const rows = payload.map((p: Row) => ({ id: p.id ?? randomUUID(), ...p }))
          t.push(...rows)
          return { data: rows.map((r: Row) => ({ ...r })), error: null }
        }
        const row = { id: payload.id ?? randomUUID(), ...payload }
        t.push(row)
        if (single || maybeSingle) return { data: { ...row }, error: null }
        return { data: [{ ...row }], error: null }
      }
      if (op === "upsert") {
        for (const incoming of payload as Row[]) {
          const existing =
            conflictCols.length > 0
              ? t.find((r) => conflictCols.every((c) => r[c] === incoming[c]))
              : undefined
          if (existing) {
            if (!ignoreDuplicates) Object.assign(existing, incoming)
          } else {
            t.push({ id: incoming.id ?? randomUUID(), ...incoming })
          }
        }
        return { error: null }
      }
      if (op === "update") {
        for (const r of matching()) Object.assign(r, payload)
        return { error: null }
      }
      if (op === "delete") {
        tables[table] = t.filter((r) => !(filters.length > 0 && filters.every((f) => f(r))))
        return { error: null }
      }
      return { data: null, error: null }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select() {
        return q
      },
      insert(row: Row) {
        op = "insert"
        payload = row
        return q
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upsert(rows: Row | Row[], options: any = {}) {
        op = "upsert"
        payload = Array.isArray(rows) ? rows : [rows]
        conflictCols = String(options.onConflict ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
        ignoreDuplicates = !!options.ignoreDuplicates
        return q
      },
      update(patch: Row) {
        op = "update"
        payload = patch
        return q
      },
      delete() {
        op = "delete"
        return q
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eq(col: string, val: any) {
        filters.push((r) => r[col] === val)
        return q
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      is(col: string, val: any) {
        filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val))
        return q
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      not(col: string, cmp: string, val: any) {
        if (cmp === "is" && val === null) filters.push((r) => r[col] !== null && r[col] !== undefined)
        return q
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gt(col: string, val: any) {
        filters.push((r) => r[col] != null && r[col] > val)
        return q
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gte(col: string, val: any) {
        filters.push((r) => r[col] != null && r[col] >= val)
        return q
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      in(col: string, vals: any[]) {
        inVals = vals
        const s = new Set(vals)
        filters.push((r) => s.has(r[col]))
        return q
      },
      // PostgREST `or` filter — supports `col.is.null` and `col.{eq,lt,gt}.value` terms.
      or(expr: string) {
        const terms = expr.split(",").map((term) => {
          const [col, cmp, ...rest] = term.split(".")
          const val = rest.join(".")
          return (r: Row) =>
            cmp === "is" && val === "null"
              ? r[col] == null
              : r[col] != null &&
                (cmp === "eq" ? String(r[col]) === val : cmp === "lt" ? r[col] < val : cmp === "gt" ? r[col] > val : false)
        })
        filters.push((r) => terms.some((f) => f(r)))
        return q
      },
      order(col: string, opts: { ascending: boolean }) {
        orderSpec = { col, ascending: opts.ascending }
        return q
      },
      limit(n: number) {
        limitN = n
        return q
      },
      maybeSingle() {
        maybeSingle = true
        return q
      },
      single() {
        single = true
        return q
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then(resolve: (v: any) => any, reject?: (e: any) => any) {
        return Promise.resolve()
          .then(run)
          .then(resolve, reject)
      },
    }
    return q
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = async (name: string, args: any) => {
    const handler = opts.rpcs?.[name]
    return handler ? { data: null, ...handler(args, tables) } : { data: null, error: { message: `no rpc ${name}` } }
  }

  return { client: { from: (t: string) => makeQuery(t), rpc }, tables, queries }
}

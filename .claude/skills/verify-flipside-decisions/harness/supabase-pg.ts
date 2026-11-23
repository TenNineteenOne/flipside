// A stand-in for the Supabase service client that runs the same calls as SQL
// against the throwaway Postgres, so route handlers and read functions hit the
// real schema and the real rpc_*_v2 functions. Covers only the calls this
// area's code makes.
// shortcut: a small query builder, not PostgREST; add an operator here when the code under check starts using one.
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

const CACHE = process.env.FLIPSIDE_FORMAL_CACHE ?? path.join(os.homedir(), ".cache/flipside-formal")
const PORT = Number(process.env.FLIPSIDE_FORMAL_PG_PORT ?? 54611)
const { Pool } = createRequire(path.join(CACHE, "package.json"))("pg")

type Rows = Record<string, unknown>[]
let client: { query(sql: string, params?: unknown[]): Promise<{ rows: Rows }>; end(): Promise<void> } | null = null

export async function sql(text: string, params: unknown[] = []): Promise<Rows> {
  if (!client) {
    client = new Pool({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres", max: 4 })
  }
  return (await client!.query(text, params)).rows
}
export async function closeSql() {
  await client?.end()
  client = null
}

/** Every statement the stand-in ran, in order (to check what a route does, and in which order). */
export const statements: string[] = []

const plain = (rows: Rows) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])))

interface Result {
  data: unknown
  error: { message: string; code?: string } | null
  count?: number | null
}

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select"
  private cols = "*"
  private where: string[] = []
  private params: unknown[] = []
  private payload: Record<string, unknown>[] = []
  private conflict = ""
  private tail = ""
  private one = false
  private returning = false
  private head = false
  constructor(private table: string) {}
  private p(v: unknown) {
    this.params.push(v)
    return `$${this.params.length}`
  }
  select(cols = "*", opts?: { head?: boolean }) {
    if (this.op === "select") {
      this.cols = cols
      this.head = !!opts?.head
    } else this.returning = true
    return this
  }
  insert(row: Record<string, unknown>) { this.op = "insert"; this.payload = [row]; return this }
  upsert(rows: Record<string, unknown> | Record<string, unknown>[], opts: { onConflict: string }) {
    this.op = "upsert"
    this.payload = Array.isArray(rows) ? rows : [rows]
    this.conflict = opts.onConflict
    return this
  }
  update(row: Record<string, unknown>) { this.op = "update"; this.payload = [row]; return this }
  delete() { this.op = "delete"; return this }
  eq(c: string, v: unknown) { this.where.push(`${c} = ${this.p(v)}`); return this }
  gt(c: string, v: unknown) { this.where.push(`${c} > ${this.p(v)}`); return this }
  gte(c: string, v: unknown) { this.where.push(`${c} >= ${this.p(v)}`); return this }
  lt(c: string, v: unknown) { this.where.push(`${c} < ${this.p(v)}`); return this }
  is(c: string, v: null) {
    if (v !== null) throw new Error("is() supports null only")
    this.where.push(`${c} is null`)
    return this
  }
  not(c: string, op: string, v: null) {
    if (op !== "is" || v !== null) throw new Error("not() supports `is null` only")
    this.where.push(`${c} is not null`)
    return this
  }
  in(c: string, vs: unknown[]) { this.where.push(`${c}::text = any(${this.p(vs.map(String))}::text[])`); return this }
  order(c: string, o?: { ascending?: boolean }) { this.tail += ` order by ${c} ${o?.ascending === false ? "desc" : "asc"}`; return this }
  limit(n: number) { this.tail += ` limit ${n}`; return this }
  range(a: number, b: number) { this.tail += ` limit ${b - a + 1} offset ${a}`; return this }
  maybeSingle() { this.one = true; return this }
  single() { this.one = true; return this }
  private build(): string {
    const where = this.where.length ? ` where ${this.where.join(" and ")}` : ""
    const ret = this.returning ? " returning *" : ""
    const val = (v: unknown) => this.p(v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) ? JSON.stringify(v) : v)
    switch (this.op) {
      case "select":
        return `select ${this.head ? "count(*)::int as count" : this.cols} from ${this.table}${where}${this.head ? "" : this.tail}`
      case "delete":
        return `delete from ${this.table}${where}${ret}`
      case "update":
        return `update ${this.table} set ${Object.entries(this.payload[0]).map(([k, v]) => `${k} = ${val(v)}`).join(", ")}${where}${ret}`
      default: {
        const keys = Object.keys(this.payload[0])
        const rows = this.payload.map((r) => `(${keys.map((k) => val(r[k])).join(", ")})`)
        const upsert = this.op === "upsert"
          ? ` on conflict (${this.conflict}) do update set ${keys.map((k) => `${k} = excluded.${k}`).join(", ")}`
          : ""
        return `insert into ${this.table} (${keys.join(", ")}) values ${rows.join(", ")}${upsert}${ret}`
      }
    }
  }
  then<A = Result, B = never>(
    ok?: ((r: Result) => A | PromiseLike<A>) | null,
    bad?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    const text = this.build()
    statements.push(text)
    const run: Promise<Result> = sql(text, this.params).then(
      (rows) =>
        this.head
          ? { data: null, error: null, count: rows[0].count as number }
          : { data: this.one ? plain(rows)[0] ?? null : plain(rows), error: null },
      (e) => ({ data: null, error: { message: String(e.message), code: e.code } }),
    )
    return run.then(ok, bad)
  }
}

export function createServiceClient() {
  return {
    from: (table: string) => new Query(table),
    async rpc(name: string, args: Record<string, unknown>): Promise<Result> {
      const keys = Object.keys(args)
      const text = `select ${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`
      statements.push(text)
      try {
        await sql(text, keys.map((k) => args[k]))
        return { data: null, error: null }
      } catch (e) {
        return { data: null, error: { message: String((e as Error).message), code: (e as { code?: string }).code } }
      }
    },
  }
}

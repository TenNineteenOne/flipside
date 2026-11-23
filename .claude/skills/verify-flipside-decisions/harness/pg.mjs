// Starts a throwaway Postgres (embedded-postgres, no admin rights), applies
// supabase/migrations in order, and hands back a pg client. Used by the vitest
// globalSetup and runnable alone: `node pg.mjs <repo>` applies and exits.
import { createRequire } from "node:module"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const CACHE = process.env.FLIPSIDE_FORMAL_CACHE ?? path.join(os.homedir(), ".cache/flipside-formal")
export const PORT = Number(process.env.FLIPSIDE_FORMAL_PG_PORT ?? 54611)
const require = createRequire(path.join(CACHE, "package.json"))

// Supabase supplies these on a real project; plain Postgres needs stand-ins
// before the migrations' policies and grants will parse.
const SUPABASE_STANDINS = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as 'select null::uuid';
`

export async function startDb(repo) {
  const EmbeddedPostgres = require("embedded-postgres").default
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flipside-formal-pg-"))
  const pg = new EmbeddedPostgres({
    databaseDir: dir, user: "postgres", password: "postgres", port: PORT, persistent: false,
    onLog: () => {}, onError: () => {},
  })
  await pg.initialise()
  await pg.start()
  const client = pg.getPgClient()
  await client.connect()
  await client.query(SUPABASE_STANDINS)
  const migrations = path.join(repo, "supabase/migrations")
  for (const f of fs.readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await client.query(fs.readFileSync(path.join(migrations, f), "utf8"))
    } catch (e) {
      await client.end(); await pg.stop()
      throw new Error(`migration ${f} failed: ${e.message}`)
    }
  }
  return {
    client,
    async stop() {
      await client.end()
      await pg.stop()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = await startDb(path.resolve(process.argv[2] ?? "."))
  const { rows } = await db.client.query(
    "select proname from pg_proc where proname like 'rpc\\_%\\_v2' order by 1")
  console.log("migrations applied; functions:", rows.map((r) => r.proname).join(", "))
  await db.stop()
}

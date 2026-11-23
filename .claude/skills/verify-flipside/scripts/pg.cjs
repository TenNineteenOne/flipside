#!/usr/bin/env node
// VERIFICATION SCAFFOLDING. This machine has no psql; this is the SQL client for the throwaway
// database (superuser, trust auth, loopback only). Run through `fv sql`, which sets NODE_PATH.
//   pg.cjs -f a.sql [b.sql ...]   apply files in order, each as one transaction, stop at first error
//   pg.cjs -c "select ..."        run one statement, print rows as JSON lines
const fs = require("node:fs")
const { Client } = require("pg")

async function main() {
  const [flag, ...args] = process.argv.slice(2)
  const c = new Client({ host: "127.0.0.1", port: Number(process.env.FV_PG_PORT), user: "postgres", database: "postgres" })
  await c.connect()
  try {
    if (flag === "-f") {
      for (const file of args) {
        try {
          await c.query(`begin;\n${fs.readFileSync(file, "utf8")}\n;commit;`)
          console.log(`applied ${file}`)
        } catch (e) {
          await c.query("rollback").catch(() => {})
          console.error(`FAILED ${file}: ${e.message}${e.position ? ` (at char ${e.position})` : ""}`)
          process.exitCode = 1
          return
        }
      }
    } else if (flag === "-c") {
      const r = await c.query(args[0])
      for (const res of [].concat(r)) {
        if (res.rows?.length) for (const row of res.rows) console.log(JSON.stringify(row))
        else console.log(`-- ${res.command} ${res.rowCount ?? 0}`)
      }
    } else {
      console.error("usage: pg.cjs -f file.sql... | -c 'sql'")
      process.exitCode = 2
    }
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })

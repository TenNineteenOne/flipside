// Reads the tables Tables.tla printed through TLC (path in FLIPSIDE_FORMAL_TABLES).
import fs from "node:fs"

export type Row = [fb: "none" | "up" | "down", seen: boolean, skip: boolean, saved: boolean]
interface Tables {
  APPLY: [Row, string, Row][]
  READ: [Row, boolean, boolean, string][]
  JUDGE: [string, string, string[], string][]
  RESTORE: [string, string, boolean, string[], boolean][]
  RTF: [string, string][]
}

export function loadTables(): Tables {
  // TLC wraps long values over several lines, so parse the text as one stream.
  const text = fs.readFileSync(process.env.FLIPSIDE_FORMAL_TABLES!, "utf8").replace(/\s+/g, " ").replace(/<< /g, "<<").replace(/ >>/g, ">>")
  const out: Tables = { APPLY: [], READ: [], JUDGE: [], RESTORE: [], RTF: [] }
  const starts = [...text.matchAll(/<<"(APPLY|READ|JUDGE|RESTORE|RTF)", /g)]
  for (const m of starts) {
    // The row ends where its brackets balance.
    let depth = 0
    let end = m.index!
    do {
      if (text.startsWith("<<", end)) { depth++; end += 2 }
      else if (text.startsWith(">>", end)) { depth--; end += 2 }
      else end++
    } while (depth > 0)
    const json = text.slice(m.index!, end).replaceAll("<<", "[").replaceAll(">>", "]").replace(/\bTRUE\b/g, "true").replace(/\bFALSE\b/g, "false")
    const [, ...row] = JSON.parse(json)
    ;(out[m[1] as keyof Tables] as unknown[]).push(row)
  }
  const want = { APPLY: 192, READ: 24, JUDGE: 12, RESTORE: 32, RTF: 4 }
  for (const [k, n] of Object.entries(want)) {
    const got = out[k as keyof Tables].length
    if (got !== n) throw new Error(`Tables.tla printed ${got} ${k} rows, expected ${n}`)
  }
  return out
}

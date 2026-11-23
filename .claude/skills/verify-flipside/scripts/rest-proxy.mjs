#!/usr/bin/env node
// VERIFICATION SCAFFOLDING. supabase-js calls <SUPABASE_URL>/rest/v1/...; PostgREST serves at /.
// This strips the prefix and forwards. Usage: rest-proxy.mjs <listen-port> <postgrest-port>
import http from "node:http"

const [listen, upstream] = process.argv.slice(2).map(Number)
http
  .createServer((req, res) => {
    if (!req.url.startsWith("/rest/v1")) return res.writeHead(404).end("verify-flipside proxy: only /rest/v1")
    const out = http.request(
      { host: "127.0.0.1", port: upstream, method: req.method, path: req.url.slice("/rest/v1".length) || "/", headers: req.headers },
      (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res) },
    )
    out.on("error", (e) => res.writeHead(502).end(String(e)))
    req.pipe(out)
  })
  .listen(listen, "127.0.0.1")

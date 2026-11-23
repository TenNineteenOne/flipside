#!/usr/bin/env node
// VERIFICATION SCAFFOLDING. HTTPS front for `next start`, so the production build runs under the
// conditions its own headers assume (CSP upgrade-insecure-requests, __Secure- cookies, https-only
// CSRF origins). Self-signed certificate made at launch; the browser context ignores cert errors.
// Usage: tls-proxy.mjs <listen-port> <next-port> <key.pem> <cert.pem>
import fs from "node:fs"
import http from "node:http"
import https from "node:https"

const [listen, upstream, key, cert] = process.argv.slice(2)
https
  .createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    const headers = { ...req.headers, "x-forwarded-proto": "https", "x-forwarded-host": req.headers.host }
    const out = http.request({ host: "127.0.0.1", port: Number(upstream), method: req.method, path: req.url, headers }, (up) => {
      res.writeHead(up.statusCode, up.headers)
      up.pipe(res)
    })
    out.on("error", (e) => res.writeHead(502).end(String(e)))
    req.pipe(out)
  })
  .listen(Number(listen), "127.0.0.1")

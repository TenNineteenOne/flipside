// usage: node shot.mjs <url> <out.png> <w> <h> [scrollY]
import { spawn } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
const [url, out, w = "390", h = "844", sy = "0"] = process.argv.slice(2)
const dir = mkdtempSync(tmpdir() + "/shot")
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--user-data-dir=${dir}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let list, port
for (let i = 0; i < 40 && !port; i++) { try { port = readFileSync(dir + "/DevToolsActivePort", "utf8").split("\n")[0] } catch {} await sleep(250) }
for (let i = 0; i < 40; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((t) => t.type === "page")) break } catch {} await sleep(250) }
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = {}
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d.result); delete pending[d.id] } }
const send = (method, params = {}) => new Promise((r) => { pending[++id] = r; ws.send(JSON.stringify({ id, method, params })) })
const mobile = +w < 768
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile })
await send("Page.enable")
await send("Page.navigate", { url })
await sleep(3500)
if (+sy) { await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${sy})` }); await sleep(600) }
const r = await send("Runtime.evaluate", { expression: "JSON.stringify({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight})", returnByValue: true })
console.log(r.result.value)
const { data } = await send("Page.captureScreenshot", { format: "png" })
writeFileSync(out, Buffer.from(data, "base64")); console.log("saved", out)
ws.close(); chrome.kill()

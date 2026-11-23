import { defineConfig } from "vitest/config"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = process.env.FLIPSIDE_REPO!
const cache = process.env.FLIPSIDE_FORMAL_CACHE ?? path.join(os.homedir(), ".cache/flipside-formal")

export default defineConfig({
  root: repo,
  cacheDir: path.join(cache, "vite"), // keep the repo's node_modules untouched
  test: {
    environment: "node",
    dir: here,
    include: ["*.check.ts"], // not *.test.ts: `npm test` must not pick these up
    setupFiles: [path.join(here, "setup.ts")],
    globalSetup: [path.join(here, "global-setup.mjs")],
    fileParallelism: false, // one database
  },
  resolve: {
    alias: {
      "@": repo,
      "server-only": path.join(repo, "node_modules/next/dist/compiled/server-only/empty.js"),
    },
  },
})

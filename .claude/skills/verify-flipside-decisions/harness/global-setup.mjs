import { startDb } from "./pg.mjs"

export default async function () {
  const db = await startDb(process.env.FLIPSIDE_REPO)
  return () => db.stop()
}

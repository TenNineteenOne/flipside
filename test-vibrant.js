const { Vibrant } = require('node-vibrant/node')

async function test() {
  try {
    const res = await fetch('https://i.scdn.co/image/ab6761610000e5ebde6f111815dc352c77df4c08', {
      headers: { "User-Agent": "Mozilla/5.0" }
    })
    console.log(res.status, res.statusText)
    if (!res.ok) throw new Error("fetch failed " + res.status)
    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const palette = await Vibrant.from(buffer).getPalette()
    console.log("Success! Vibrant:", palette.Vibrant.hex)
  } catch (err) {
    console.error("Vibrant error:", err.message)
    console.error(err)
  }
}
test()

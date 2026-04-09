// test-colour.js
async function test() {
  try {
    const imageUrl = "https://i.scdn.co/image/ab6761610000e5ebde6f111815dc352c77df4c08";
    const res = await fetch(imageUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error("fetch failed " + res.status);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    console.log("Buffer size:", buffer.length);
    
    // using node-vibrant/node
    const { Vibrant } = require('node-vibrant/node');
    const palette = await Vibrant.from(buffer).getPalette();
    
    console.log("Palette:", !!palette);
    console.log("Vibrant Hex:", palette.Vibrant ? palette.Vibrant.hex : null);
  } catch (err) {
    console.error("Error:", err);
  }
}
test();

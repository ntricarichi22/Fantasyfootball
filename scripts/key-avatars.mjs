// Flood-fill the near-white background of an illustrated portrait to
// transparent, seeding only from the image borders so interior whites
// (teeth, eyes, collar) are preserved. Usage:
//   node scripts/key-avatars.mjs <input.png> <output.png>
import sharp from "sharp"

const [, , inPath, outPath, minLightArg, maxChromaArg] = process.argv
if (!inPath || !outPath) {
  console.error("usage: node scripts/key-avatars.mjs <input> <output> [minLight] [maxChroma]")
  process.exit(1)
}
const MIN_LIGHT = minLightArg ? Number(minLightArg) : 232
const MAX_CHROMA = maxChromaArg ? Number(maxChromaArg) : 16

const { data, info } = await sharp(inPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const { width, height } = info
const N = width * height

const isLight = (i) => {
  const r = data[i * 4]
  const g = data[i * 4 + 1]
  const b = data[i * 4 + 2]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return min >= MIN_LIGHT && max - min <= MAX_CHROMA
}

const bg = new Uint8Array(N) // 1 = background
const stack = []
const push = (x, y) => {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  const i = y * width + x
  if (bg[i] || !isLight(i)) return
  bg[i] = 1
  stack.push(i)
}
// Seed from the top and the upper portion of the side borders only. The
// subject's shoulders/torso occupy the bottom, and light clothing there
// would otherwise let the fill leak in from the bottom or lower sides.
const sideLimit = Math.floor(height * 0.55)
for (let x = 0; x < width; x++) {
  push(x, 0)
}
for (let y = 0; y < sideLimit; y++) {
  push(0, y)
  push(width - 1, y)
}
while (stack.length) {
  const i = stack.pop()
  const x = i % width
  const y = (i / width) | 0
  push(x - 1, y)
  push(x + 1, y)
  push(x, y - 1)
  push(x, y + 1)
}

// Hard-clear background to transparent. Then soften 1px fringe: any
// remaining light pixel touching transparency gets partial alpha so the
// anti-aliased halo around hair/edges doesn't read as a white outline.
for (let i = 0; i < N; i++) {
  if (bg[i]) data[i * 4 + 3] = 0
}
let feathered = 0
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = y * width + x
    if (bg[i] || !isLight(i)) continue
    const touches =
      (x > 0 && bg[i - 1]) ||
      (x < width - 1 && bg[i + 1]) ||
      (y > 0 && bg[i - width]) ||
      (y < height - 1 && bg[i + width])
    if (touches) {
      data[i * 4 + 3] = 90
      feathered++
    }
  }
}

const cleared = bg.reduce((a, v) => a + v, 0)
await sharp(data, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(outPath)
console.log(
  `${outPath}: ${width}x${height}, cleared ${((cleared / N) * 100).toFixed(1)}% bg, feathered ${feathered}px`,
)

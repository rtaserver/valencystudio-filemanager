import sharp from 'sharp'
import { readFile } from 'fs/promises'

const svg = await readFile('/home/z/my-project/public/icon.svg')

for (const size of [192, 512, 180]) {
  const out = size === 180 ? '/home/z/my-project/public/apple-touch-icon.png' : `/home/z/my-project/public/icon-${size}.png`
  await sharp(svg, { density: 400 })
    .resize(size, size)
    .png()
    .toFile(out)
  console.log('wrote', out)
}

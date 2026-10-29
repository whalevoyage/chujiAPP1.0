// 一键生成所有 App 图标（PWA + Android）
// 在 frontend 目录运行：npm ci && node scripts/generate-icons.js
// Sharp 已列在 devDependencies 中。

import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const source = path.join(root, 'public', 'vault-icon.svg')

// PWA 图标尺寸
const pwaSizes = [192, 512]

// Android 自适应图标前景（ic_launcher_foreground）
// 108dp 安全区，在各密度下等比缩放
const adaptiveDensities = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
}

// Android 传统图标（ic_launcher，API < 26 回退）
const legacyDensities = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
}

async function generate() {
  console.log('Generating icons from:', source)
  console.log('')

  // ── PWA 图标 ──
  for (const size of pwaSizes) {
    const dest = path.join(root, 'public', `icon-${size}.png`)
    await sharp(source).resize(size, size).png().toFile(dest)
    console.log(`  PWA ${size}x${size}  →  ${dest}`)
  }

  // ── Android 自适应图标前景 ──
  for (const [density, size] of Object.entries(adaptiveDensities)) {
    const dir = path.join(root, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`)
    fs.mkdirSync(dir, { recursive: true })
    const dest = path.join(dir, 'ic_launcher_foreground.png')
    await sharp(source).resize(size, size).png().toFile(dest)
    console.log(`  Adaptive ${density} (${size}dp)  →  ${dest}`)
  }

  // ── Android 传统图标 ──
  for (const [density, size] of Object.entries(legacyDensities)) {
    const dir = path.join(root, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`)
    fs.mkdirSync(dir, { recursive: true })
    const dest = path.join(dir, 'ic_launcher.png')
    await sharp(source).resize(size, size).png().toFile(dest)
    console.log(`  Legacy ${density} (${size}dp)  →  ${dest}`)
  }

  // ── 自适应图标背景 ──
  const drawableDir = path.join(root, 'android', 'app', 'src', 'main', 'res', 'drawable')
  fs.mkdirSync(drawableDir, { recursive: true })

  const bgXml = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="#F7F4EE" />
    <corners android:radius="22%" />
</shape>`
  fs.writeFileSync(path.join(drawableDir, 'ic_launcher_background.xml'), bgXml, 'utf-8')
  console.log(`  Background XML  →  ${path.join(drawableDir, 'ic_launcher_background.xml')}`)

  // ── 自适应图标定义 ──
  const adaptiveDir = path.join(root, 'android', 'app', 'src', 'main', 'res', 'mipmap-anydpi-v26')
  fs.mkdirSync(adaptiveDir, { recursive: true })

  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>`
  fs.writeFileSync(path.join(adaptiveDir, 'ic_launcher.xml'), adaptiveXml, 'utf-8')
  console.log(`  Adaptive XML  →  ${path.join(adaptiveDir, 'ic_launcher.xml')}`)

  console.log('')
  console.log('All icons generated successfully.')
}

generate().catch(err => {
  console.error('Icon generation failed:', err)
  process.exit(1)
})

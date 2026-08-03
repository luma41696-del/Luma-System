#!/usr/bin/env node
/**
 * Build a multi-resolution Windows .ico from the brand mark.
 *
 * Windows picks a different size for the taskbar, the desktop shortcut, Alt-Tab
 * and the installer, so a single-size icon looks blurry in most of them. The
 * Vista+ ICO format can embed PNGs directly, which keeps the alpha channel
 * intact — so each size is a PNG written into one container.
 *
 *   node desktop/make-icon.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets', 'logo', 'luma-mark-yellow.png');
const OUT_DIR = path.join(__dirname, 'build');
const OUT_ICO = path.join(OUT_DIR, 'icon.ico');
const OUT_PNG = path.join(OUT_DIR, 'icon.png');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Render the mark centred on a transparent square at `size`.
 * The mark is tall and narrow (216x604), so it is scaled to fit the height and
 * centred horizontally rather than stretched.
 */
function renderSquare(size, destination) {
  const script = `
Add-Type -AssemblyName System.Drawing
$src = New-Object System.Drawing.Bitmap('${SOURCE.replace(/\\/g, '\\\\')}')
$dst = New-Object System.Drawing.Bitmap(${size}, ${size}, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)
$pad = [Math]::Round(${size} * 0.10)
$h = ${size} - (2 * $pad)
$w = [Math]::Round($h * $src.Width / $src.Height)
$x = [Math]::Round((${size} - $w) / 2)
$g.DrawImage($src, $x, $pad, $w, $h)
$g.Dispose()
$dst.Save('${destination.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$dst.Dispose(); $src.Dispose()
`;
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { stdio: 'pipe' });
}

function buildIco(pngPaths) {
  const images = pngPaths.map((p) => fs.readFileSync(p));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // type: icon
  header.writeUInt16LE(images.length, 4);  // image count

  const entries = [];
  let offset = 6 + images.length * 16;

  images.forEach((data, i) => {
    const size = SIZES[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);   // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);                        // palette
    entry.writeUInt8(0, 3);                        // reserved
    entry.writeUInt16LE(1, 4);                     // colour planes
    entry.writeUInt16LE(32, 6);                    // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  });

  return Buffer.concat([header, ...entries, ...images]);
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`✗ brand mark not found: ${SOURCE}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const temps = [];
  for (const size of SIZES) {
    const file = path.join(OUT_DIR, `_${size}.png`);
    renderSquare(size, file);
    temps.push(file);
  }

  fs.writeFileSync(OUT_ICO, buildIco(temps));
  fs.copyFileSync(path.join(OUT_DIR, '_256.png'), OUT_PNG);   // Linux / fallback
  temps.forEach((f) => fs.unlinkSync(f));

  console.log(`✓ icon.ico  (${SIZES.join(', ')} px — ${(fs.statSync(OUT_ICO).size / 1024).toFixed(1)} KB)`);
  console.log(`✓ icon.png  (256 px)`);
}

main();

#!/usr/bin/env node
/**
 * Build the Luma app icon: the brand mark on a navy rounded square, with a warm
 * glow behind the star — the artwork the client supplied.
 *
 * Produces
 *   assets/logo/app-icon.png     1024, the master
 *   assets/logo/favicon.png      64, the browser tab
 *   desktop/build/icon.ico       16-256, every size Windows asks for
 *   desktop/build/icon.png       512, Linux / fallback
 *
 * A single-size icon looks blurry in the taskbar, Alt-Tab and the installer,
 * so each size is rendered separately rather than scaled from one bitmap.
 *
 *   node desktop/make-icon.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DESKTOP = __dirname;
const ROOT = path.join(DESKTOP, '..');
const MARK = path.join(ROOT, 'assets', 'logo', 'luma-mark-light.png');  // white mark, alpha
const BUILD = path.join(DESKTOP, 'build');
const LOGO_DIR = path.join(ROOT, 'assets', 'logo');

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Render one square icon.
 * The mark is 216x604 — tall and narrow — so it is fitted by height and centred,
 * never stretched.
 */
function render(size, destination) {
  const radius = Math.round(size * 0.22);          // rounded-square corner
  const glowY = Math.round(size * 0.255);          // centre of the star
  const glowR = Math.round(size * 0.20);

  const script = `
Add-Type -AssemblyName System.Drawing
$S = ${size}
$bmp = New-Object System.Drawing.Bitmap($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::Transparent)

# navy rounded square
$r = ${radius}
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(0, 0, 2*$r, 2*$r, 180, 90)
$path.AddArc($S - 2*$r, 0, 2*$r, 2*$r, 270, 90)
$path.AddArc($S - 2*$r, $S - 2*$r, 2*$r, 2*$r, 0, 90)
$path.AddArc(0, $S - 2*$r, 2*$r, 2*$r, 90, 90)
$path.CloseFigure()
$navy = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 20, 27, 52))
$g.FillPath($navy, $path)
$g.SetClip($path)

# warm glow behind the star — a true radial gradient, so there is no banding
$gy = ${glowY}; $gr = ${glowR}
$gp = New-Object System.Drawing.Drawing2D.GraphicsPath
$gp.AddEllipse(($S/2 - $gr), ($gy - $gr), (2*$gr), (2*$gr))
$pg = New-Object System.Drawing.Drawing2D.PathGradientBrush($gp)
$pg.CenterColor = [System.Drawing.Color]::FromArgb(190, 255, 186, 88)
$pg.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 176, 60))
$blend = New-Object System.Drawing.Drawing2D.Blend(3)
$blend.Factors = @(0.0, 0.45, 1.0)
$blend.Positions = @(0.0, 0.55, 1.0)
$pg.Blend = $blend
$g.FillPath($pg, $gp)
$pg.Dispose(); $gp.Dispose()

# the white mark, fitted by height
$src = New-Object System.Drawing.Bitmap('${MARK.replace(/\\/g, '\\\\')}')
$h = [int]($S * 0.62)
$w = [int]($h * $src.Width / $src.Height)
$x = [int](($S - $w) / 2)
$y = [int](($S - $h) / 2)
$g.DrawImage($src, $x, $y, $w, $h)

$g.ResetClip(); $g.Dispose()
$bmp.Save('${destination.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose(); $src.Dispose(); $navy.Dispose(); $path.Dispose()
`;
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { stdio: 'pipe' });
}

/** Vista+ ICO: a container of PNGs, which keeps the alpha channel intact. */
function buildIco(pngPaths, sizes) {
  const images = pngPaths.map((p) => fs.readFileSync(p));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;

  images.forEach((data, i) => {
    const size = sizes[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);   // 0 encodes 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  });

  return Buffer.concat([header, ...entries, ...images]);
}

function main() {
  if (!fs.existsSync(MARK)) {
    console.error(`✗ brand mark not found: ${MARK}`);
    process.exit(1);
  }
  fs.mkdirSync(BUILD, { recursive: true });

  const temps = [];
  for (const size of ICO_SIZES) {
    const file = path.join(BUILD, `_${size}.png`);
    render(size, file);
    temps.push(file);
  }
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), buildIco(temps, ICO_SIZES));

  render(512, path.join(BUILD, 'icon.png'));
  render(1024, path.join(LOGO_DIR, 'app-icon.png'));
  render(64, path.join(LOGO_DIR, 'favicon.png'));
  render(180, path.join(LOGO_DIR, 'apple-touch-icon.png'));

  temps.forEach((f) => fs.unlinkSync(f));

  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1);
  console.log(`✓ desktop/build/icon.ico          ${ICO_SIZES.join(', ')} px — ${kb(path.join(BUILD, 'icon.ico'))} KB`);
  console.log(`✓ desktop/build/icon.png          512 px`);
  console.log(`✓ assets/logo/app-icon.png        1024 px`);
  console.log(`✓ assets/logo/favicon.png         64 px`);
  console.log(`✓ assets/logo/apple-touch-icon.png 180 px`);
}

main();

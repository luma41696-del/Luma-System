#!/usr/bin/env node
/**
 * Build the Luma app icon: a navy rounded square with a white sparkle (tight
 * warm glow behind it), a circle, and a bar stacked underneath — the simplified
 * mark the client chose over the full logotype, since the detailed swoosh in
 * the original mark turns to mush at 16-32px (taskbar / favicon sizes).
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
const BUILD = path.join(DESKTOP, 'build');
const LOGO_DIR = path.join(ROOT, 'assets', 'logo');

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Render one square icon: navy squircle + sparkle (glow) + circle + bar. */
function render(size, destination) {
  const radius = Math.round(size * 0.22);   // rounded-square corner

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

$cx = $S / 2.0
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)

# --- sparkle, top ---
$starCY = $S * 0.251
$R = $S * 0.150
$w = $R * 0.20

# warm glow behind the sparkle only — a true radial gradient, so there is no banding
$gr = $S * 0.195
$gp = New-Object System.Drawing.Drawing2D.GraphicsPath
$gp.AddEllipse(($cx - $gr), ($starCY - $gr), (2*$gr), (2*$gr))
$pg = New-Object System.Drawing.Drawing2D.PathGradientBrush($gp)
$pg.CenterColor = [System.Drawing.Color]::FromArgb(210, 255, 190, 90)
$pg.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 176, 60))
$blend = New-Object System.Drawing.Drawing2D.Blend(3)
$blend.Factors = @(0.0, 0.4, 1.0)
$blend.Positions = @(0.0, 0.5, 1.0)
$pg.Blend = $blend
$g.FillPath($pg, $gp)
$pg.Dispose(); $gp.Dispose()

$starPts = [System.Drawing.PointF[]]@(
  (New-Object System.Drawing.PointF($cx, ($starCY - $R))),
  (New-Object System.Drawing.PointF(($cx + $w), ($starCY - $w))),
  (New-Object System.Drawing.PointF(($cx + $R), $starCY)),
  (New-Object System.Drawing.PointF(($cx + $w), ($starCY + $w))),
  (New-Object System.Drawing.PointF($cx, ($starCY + $R))),
  (New-Object System.Drawing.PointF(($cx - $w), ($starCY + $w))),
  (New-Object System.Drawing.PointF(($cx - $R), $starCY)),
  (New-Object System.Drawing.PointF(($cx - $w), ($starCY - $w)))
)
$starPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$starPath.AddClosedCurve($starPts, 0.62)
$g.FillPath($white, $starPath)
$starPath.Dispose()

# --- circle, middle ---
$circR = $S * 0.150
$circCY = $S * 0.576
$g.FillEllipse($white, ($cx - $circR), ($circCY - $circR), (2*$circR), (2*$circR))

# --- bar, bottom ---
$barW = $S * 0.275
$barH = $S * 0.108
$barY = $S * 0.775
$barX = $cx - $barW / 2.0
$barR = $S * 0.022
$barPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$barPath.AddArc($barX, $barY, 2*$barR, 2*$barR, 180, 90)
$barPath.AddArc(($barX + $barW - 2*$barR), $barY, 2*$barR, 2*$barR, 270, 90)
$barPath.AddArc(($barX + $barW - 2*$barR), ($barY + $barH - 2*$barR), 2*$barR, 2*$barR, 0, 90)
$barPath.AddArc($barX, ($barY + $barH - 2*$barR), 2*$barR, 2*$barR, 90, 90)
$barPath.CloseFigure()
$g.FillPath($white, $barPath)
$barPath.Dispose()

$g.ResetClip(); $g.Dispose()
$bmp.Save('${destination.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose(); $white.Dispose(); $navy.Dispose(); $path.Dispose()
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

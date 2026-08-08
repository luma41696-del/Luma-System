#!/usr/bin/env node
/**
 * Build the full-colour brand logo: the metallic Luma mark with the glowing
 * sparkle above it, as supplied by the client.
 *
 * The source artwork (`luma_logo_crop.png`) is the metal lettering only — the
 * sparkle and its warm glow are not baked in, so they are rendered here and
 * composited on top. Keeping this as a script means the glow can be retuned
 * without hand-editing a PNG.
 *
 * Produces
 *   assets/logo/luma-logo.png   full colour, transparent background
 *
 * Sits alongside make-icon.js, which builds the square app icon from the same
 * brand elements.
 *
 *   node desktop/make-logo.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets', 'logo', 'luma_logo_crop.png');
const LOGO_DIR = path.join(ROOT, 'assets', 'logo');

/** Rendered width. Large enough for a 2× auth-hero mark with room to spare. */
const WIDTH = 420;

/**
 * Two cuts of the same logo.
 *
 * The generous glow reads beautifully at hero size but wastes most of the box
 * at 64px in the sidebar, shrinking the lettering to a sliver. The compact cut
 * keeps the sparkle — it is part of the mark — on a tight halo instead.
 */
const VARIANTS = [
  { file: 'luma-logo.png',       headroom: 0.62, star: 0.175, glow: 0.40, glowAlpha: 215 },
  { file: 'luma-mark-color.png', headroom: 0.30, star: 0.105, glow: 0.20, glowAlpha: 190 }
];

function render({ file, headroom, star, glow, glowAlpha }) {
  const out = path.join(LOGO_DIR, file);
  const script = `
Add-Type -AssemblyName System.Drawing

$src = New-Object System.Drawing.Bitmap('${SOURCE.replace(/\\/g, '\\\\')}')
$W = ${WIDTH}
$scale = $W / $src.Width
$logoH = [int]($src.Height * $scale)

# Headroom above the lettering for the sparkle and its glow.
$headroom = [int]($W * ${headroom})
$H = $headroom + $logoH

$bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

# --- warm glow, behind the sparkle ---
# A true radial gradient rather than stacked ellipses, which band visibly.
$cx = $W * 0.50
$cy = $headroom * 0.46
$gr = $W * ${glow}
$gp = New-Object System.Drawing.Drawing2D.GraphicsPath
$gp.AddEllipse(($cx - $gr), ($cy - $gr), (2*$gr), (2*$gr))
$pg = New-Object System.Drawing.Drawing2D.PathGradientBrush($gp)
$pg.CenterColor = [System.Drawing.Color]::FromArgb(${glowAlpha}, 255, 176, 74)
$pg.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 158, 40))
$blend = New-Object System.Drawing.Drawing2D.Blend(3)
$blend.Factors = @(0.0, 0.38, 1.0)
$blend.Positions = @(0.0, 0.52, 1.0)
$pg.Blend = $blend
$g.FillPath($pg, $gp)
$pg.Dispose(); $gp.Dispose()

# --- four-point sparkle ---
# AddClosedCurve with a low tension gives the concave "star flare" waist.
# NB: PowerShell variable names are case-insensitive, so nothing here may be
# called $w — it would silently overwrite the canvas width $W.
$R = $W * ${star}
$waist = $R * 0.19
$pts = [System.Drawing.PointF[]]@(
  (New-Object System.Drawing.PointF($cx, ($cy - $R))),
  (New-Object System.Drawing.PointF(($cx + $waist), ($cy - $waist))),
  (New-Object System.Drawing.PointF(($cx + $R), $cy)),
  (New-Object System.Drawing.PointF(($cx + $waist), ($cy + $waist))),
  (New-Object System.Drawing.PointF($cx, ($cy + $R))),
  (New-Object System.Drawing.PointF(($cx - $waist), ($cy + $waist))),
  (New-Object System.Drawing.PointF(($cx - $R), $cy)),
  (New-Object System.Drawing.PointF(($cx - $waist), ($cy - $waist)))
)
$star = New-Object System.Drawing.Drawing2D.GraphicsPath
$star.AddClosedCurve($pts, 0.62)
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 252, 242))
$g.FillPath($white, $star)
$star.Dispose(); $white.Dispose()

# --- the metal lettering ---
$g.DrawImage($src, 0, $headroom, $W, $logoH)

$g.Dispose()
$bmp.Save('${out.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
"$W x $H"
$bmp.Dispose(); $src.Dispose()
`;

  const size = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8' }).trim();

  const kb = (fs.statSync(out).size / 1024).toFixed(1);
  console.log(`✓ assets/logo/${file.padEnd(20)} ${size} px — ${kb} KB`);
  return size;
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`✗ source artwork not found: ${SOURCE}`);
    process.exit(1);
  }
  VARIANTS.forEach(render);
}

main();

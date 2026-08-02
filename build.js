#!/usr/bin/env node
/**
 * Assemble the deployable frontend into ./dist
 *
 * This exists for one important reason: publishing the repository root would
 * expose things that must never be on a public web server —
 *
 *   functions/            server code, including the vault encryption logic
 *   functions/scripts/    the admin seed scripts
 *   emulator-data/        local Auth export, WITH PASSWORD HASHES
 *   .env* / .secret.local secrets
 *   *.md                  internal setup notes
 *
 * So instead of excluding files, we copy in only what the browser needs.
 *
 *   node build.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist');

/** Everything the browser actually loads. */
const FILES = [
  'index.html',
  'dashboard.html',
  '404.html',
  'firebase-messaging-sw.js'
];

const DIRS = [
  'assets',
  'css',
  'js'
];

/** Never copy these, even from inside an allowed directory. */
const DENY = [
  /(^|[\\/])\.env/i,
  /\.secret\.local$/i,
  /service-account.*\.json$/i,
  /(^|[\\/])\.DS_Store$/i,
  /(^|[\\/])Thumbs\.db$/i
];

function denied(rel) {
  return DENY.some((re) => re.test(rel));
}

function copyDir(src, dest, stats) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    const rel = path.relative(ROOT, from);
    if (denied(rel)) { stats.skipped.push(rel); continue; }

    if (entry.isDirectory()) copyDir(from, to, stats);
    else {
      fs.copyFileSync(from, to);
      stats.files++;
      stats.bytes += fs.statSync(to).size;
    }
  }
}

/**
 * Inject the public client keys from the build environment.
 *
 * These are *public* identifiers (a reCAPTCHA site key and a VAPID public key),
 * not secrets — but keeping them in Netlify's environment rather than in the
 * committed HTML means each deploy target can carry its own values.
 *
 *   Netlify → Site settings → Environment variables
 *     LUMA_APPCHECK_SITE_KEY = 6L...
 *     LUMA_FCM_VAPID_KEY     = BL...
 */
function injectKeys(html) {
  const appCheck = process.env.LUMA_APPCHECK_SITE_KEY || '';
  const vapid = process.env.LUMA_FCM_VAPID_KEY || '';
  // On Netlify the privileged handlers run as a Netlify Function rather than a
  // Cloud Function, so the client is told where to send callable requests.
  // NETLIFY is set automatically during a Netlify build.
  const apiBase = process.env.LUMA_API_BASE || (process.env.NETLIFY ? '/api' : '');

  if (!appCheck && !vapid && !apiBase) return html;

  const snippet = `  <script>
    window.__LUMA_APPCHECK_SITE_KEY__ = ${JSON.stringify(appCheck)};
    window.__LUMA_FCM_VAPID_KEY__ = ${JSON.stringify(vapid)};
    window.__LUMA_API_BASE__ = ${JSON.stringify(apiBase)};
  </script>\n`;

  // Must run before the module scripts read them.
  return html.replace(/<\/head>/i, `${snippet}</head>`);
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const stats = { files: 0, bytes: 0, skipped: [] };
  const injected = !!(process.env.LUMA_APPCHECK_SITE_KEY || process.env.LUMA_FCM_VAPID_KEY);

  for (const file of FILES) {
    const from = path.join(ROOT, file);
    if (!fs.existsSync(from)) {
      console.warn(`  ! missing (skipped): ${file}`);
      continue;
    }
    if (file.endsWith('.html')) {
      fs.writeFileSync(path.join(OUT, file), injectKeys(fs.readFileSync(from, 'utf8')));
    } else {
      fs.copyFileSync(from, path.join(OUT, file));
    }
    stats.files++;
    stats.bytes += fs.statSync(path.join(OUT, file)).size;
  }

  if (injected) console.log('  · injected public client keys from the environment');
  else console.log('  · no LUMA_APPCHECK_SITE_KEY / LUMA_FCM_VAPID_KEY set — App Check and Web Push stay off');

  for (const dir of DIRS) {
    const from = path.join(ROOT, dir);
    if (!fs.existsSync(from)) {
      console.warn(`  ! missing (skipped): ${dir}/`);
      continue;
    }
    copyDir(from, path.join(OUT, dir), stats);
  }

  // Fail loudly rather than shipping a broken or unsafe bundle.
  const mustExist = ['index.html', 'dashboard.html', 'js/app.js', 'css/variables.css'];
  const missing = mustExist.filter((f) => !fs.existsSync(path.join(OUT, f)));
  if (missing.length) {
    console.error(`\n✗ build incomplete — missing: ${missing.join(', ')}\n`);
    process.exit(1);
  }

  const leaked = [];
  (function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (denied(path.relative(OUT, full))) leaked.push(path.relative(OUT, full));
    }
  })(OUT);
  if (leaked.length) {
    console.error(`\n✗ refusing to publish — secret-looking files in dist: ${leaked.join(', ')}\n`);
    process.exit(1);
  }

  console.log(`\n✓ dist ready — ${stats.files} files, ${(stats.bytes / 1024).toFixed(0)} KB`);
  if (stats.skipped.length) console.log(`  skipped: ${stats.skipped.join(', ')}`);
  console.log('  (functions/, emulator-data/, scripts and docs are NOT included)\n');
}

main();

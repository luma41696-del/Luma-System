#!/usr/bin/env node
/**
 * Stage the frontend for the desktop build.
 *
 * Reuses the same build.js the web deploy uses, so the app and the website ship
 * byte-identical UI — there is no separate desktop fork to drift out of sync.
 * The output is copied to desktop/app/, which is what electron-builder packages.
 *
 *   node desktop/prepare.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DESKTOP = __dirname;
const ROOT = path.join(DESKTOP, '..');
const DIST = path.join(ROOT, 'dist');
const APP = path.join(DESKTOP, 'app');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function count(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? count(path.join(dir, entry.name)) : 1;
  }
  return n;
}

function main() {
  console.log('› building the shared frontend…');
  // No LUMA_API_BASE here: the desktop app talks to the same backend the web
  // build is configured for. Set it in the environment to point elsewhere.
  execFileSync(process.execPath, [path.join(ROOT, 'build.js')], {
    cwd: ROOT,
    stdio: 'inherit'
  });

  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('\n✗ dist/ was not produced — cannot package the desktop app.\n');
    process.exit(1);
  }

  fs.rmSync(APP, { recursive: true, force: true });
  copyDir(DIST, APP);

  // The desktop shell serves files over http://127.0.0.1, so a service worker
  // registered for push would be scoped to a throwaway origin and never fire.
  // Electron delivers notifications natively instead.
  const sw = path.join(APP, 'firebase-messaging-sw.js');
  if (fs.existsSync(sw)) fs.rmSync(sw);

  console.log(`\n✓ desktop/app ready — ${count(APP)} files\n`);
}

main();

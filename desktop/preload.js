/**
 * Preload bridge.
 *
 * Runs with contextIsolation on, so the page never touches Node. Only a tiny,
 * read-only surface is exposed — enough for the UI to know it is running in the
 * desktop app, and nothing that could be abused if a page were ever compromised.
 */

'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('luma', {
  isDesktop: true,
  platform: process.platform,
  version: process.env.npm_package_version || null
});

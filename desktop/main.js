/**
 * Luma Agency — Windows desktop shell (Electron main process).
 *
 * The desktop build is not a separate product: it ships the same frontend and
 * talks to the same Firebase backend, so an employee on the app and a colleague
 * in a browser see the same data in real time.
 *
 * Why a local HTTP server instead of loading files directly:
 * Firebase Authentication and Firestore need a real web origin. Under file://
 * the origin is opaque, IndexedDB behaves differently and the offline cache
 * breaks. Serving the bundled files from 127.0.0.1 gives a normal origin, so
 * the exact same code paths run as on the web.
 */

'use strict';

const { app, BrowserWindow, shell, Menu, dialog, Tray, nativeImage } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, 'app');           // the built frontend
const ICON = path.join(__dirname, 'build', 'icon.ico');
const USE_EMULATOR = process.argv.includes('--emulator');

let mainWindow = null;
let tray = null;
let serverOrigin = null;

/* Single instance: a second launch focuses the existing window. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

/* -------------------------------------------------------------- static server */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      } catch {
        res.writeHead(400).end('Bad request');
        return;
      }
      if (pathname === '/') pathname = '/index.html';

      // Resolve inside APP_DIR only — never serve anything outside the bundle.
      const target = path.join(APP_DIR, path.normalize(pathname).replace(/^([/\\])+/, ''));
      if (!target.startsWith(APP_DIR)) {
        res.writeHead(403).end('Forbidden');
        return;
      }

      fs.readFile(target, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('غير موجود');
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(data);
      });
    });

    server.on('error', reject);
    // Port 0 lets the OS pick a free one, so two copies never collide.
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

/* --------------------------------------------------------------------- window */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#05121F',       // matches --bg-app, so no white flash
    icon: fs.existsSync(ICON) ? ICON : undefined,
    title: 'نظام إدارة لوما',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  const startUrl = `${serverOrigin}/index.html${USE_EMULATOR ? '?emulator=1' : ''}`;
  mainWindow.loadURL(startUrl);

  /* External links open in the real browser, never inside the app shell. */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(serverOrigin)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  /* No remote content may ever be granted permissions it does not need. */
  mainWindow.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'notifications');
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    dialog.showErrorBox('توقف التطبيق', `سبب التوقف: ${details.reason}\nأعد تشغيل البرنامج.`);
  });
}

/* ----------------------------------------------------------------------- menu */

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'ملف',
      submenu: [
        { label: 'تحديث الصفحة', accelerator: 'F5', click: () => mainWindow?.reload() },
        { type: 'separator' },
        { label: 'إغلاق', accelerator: 'Alt+F4', role: 'quit' }
      ]
    },
    {
      label: 'تحرير',
      submenu: [
        { label: 'تراجع', role: 'undo' },
        { label: 'إعادة', role: 'redo' },
        { type: 'separator' },
        { label: 'قص', role: 'cut' },
        { label: 'نسخ', role: 'copy' },
        { label: 'لصق', role: 'paste' },
        { label: 'تحديد الكل', role: 'selectAll' }
      ]
    },
    {
      label: 'عرض',
      submenu: [
        { label: 'تكبير', role: 'zoomIn', accelerator: 'CommandOrControl+Plus' },
        { label: 'تصغير', role: 'zoomOut' },
        { label: 'الحجم الأصلي', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'ملء الشاشة', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'أدوات المطور', role: 'toggleDevTools' }
      ]
    },
    {
      label: 'مساعدة',
      submenu: [
        {
          label: 'عن البرنامج',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'نظام إدارة لوما',
            message: 'نظام إدارة وكالة لوما',
            detail: `الإصدار ${app.getVersion()}\n\n` +
              'نسخة سطح المكتب — تتصل بنفس قاعدة البيانات المستخدمة في نسخة المتصفح، ' +
              'فالبيانات مشتركة ومتزامنة لحظياً.',
            buttons: ['حسناً']
          })
        }
      ]
    }
  ]));
}

/* ----------------------------------------------------------------------- tray */

function buildTray() {
  if (!fs.existsSync(ICON)) return;
  try {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.setToolTip('نظام إدارة لوما');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'فتح النظام', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { type: 'separator' },
      { label: 'إغلاق', role: 'quit' }
    ]));
    tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
  } catch (err) {
    console.warn('[luma] tray unavailable:', err.message);
  }
}

/* ------------------------------------------------------------------ lifecycle */

app.whenReady().then(async () => {
  if (!fs.existsSync(path.join(APP_DIR, 'index.html'))) {
    dialog.showErrorBox(
      'ملفات التطبيق ناقصة',
      'لم يتم العثور على واجهة النظام.\n\nشغّل: npm run build  داخل مجلد desktop.'
    );
    app.quit();
    return;
  }

  try {
    serverOrigin = await startServer();
  } catch (err) {
    dialog.showErrorBox('تعذّر بدء التطبيق', `فشل تشغيل الخادم المحلي:\n${err.message}`);
    app.quit();
    return;
  }

  buildMenu();
  createWindow();
  buildTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());

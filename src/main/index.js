'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

const {
  app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, screen,
} = require('electron');

const paths = require('./paths');
const win32 = require('./win32');
const agent = require('./agent');
const { Journal } = require('./journal');
const { createRelay } = require('./relay');
const { Tunnel } = require('./tunnel');
const { generateKey, pairingBlock } = require('./key');
const startup = require('./startup');

startup.installCrashHandlers();

const VERSION = app.getVersion();
startup.log('boot', {
  version: VERSION,
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  packaged: app.isPackaged,
  elevated: process.env.PCBRIDGE_ELEVATED || 'unknown',
});
const CHAT_URL = 'https://arena.ai/';

/** Shared state, passed to the relay and the agent driver. */
const state = {
  version: VERSION,
  hostname: process.env.COMPUTERNAME || 'unknown-host',
  startedAt: Date.now(),
  journal: null,
  key: generateKey(),
  active: true,
  commands: 0,
  notes: 0,
  tunnel: null,
  stage: null,
};

let mainWindow = null;
let overlayWindow = null;
let chatWindow = null;
let tray = null;
let relay = null;
let tunnel = null;
let launcherGeometry = null;
let virtualCursor = { x: 640, y: 420 };

state.journal = new Journal(paths.logPath());

function writeKeyFile() {
  try {
    fs.writeFileSync(paths.keyPath(), pairingBundle(), 'utf8');
  } catch {
    /* the key file is a convenience, not a requirement */
  }
}

function pairingBundle() {
  const block = pairingBlock({ url: state.tunnel?.url, key: state.key });
  const promptPath = path.join(__dirname, '..', '..', 'docs', 'PAIRING_PROMPT.txt');
  let prompt = '';
  try {
    prompt = fs.readFileSync(promptPath, 'utf8');
  } catch {
    prompt = '';
  }
  return prompt ? `${block}\n\n---\n\n${prompt}` : block;
}

function snapshot() {
  return {
    version: VERSION,
    hostname: state.hostname,
    port: relay ? relay.port : 0,
    tunnel_url: state.tunnel?.url || null,
    pairing: pairingBlock({ url: state.tunnel?.url, key: state.key }),
    active: state.active,
    stage: state.journal.stage,
    elevated: true, // the manifest requests administrator rights
    uptime_seconds: Math.round((Date.now() - state.startedAt) / 1000),
    commands: state.commands,
    notes: state.notes,
    data_dir: paths.dataDir(),
  };
}

function broadcastSnapshot() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state', snapshot());
  }
}

// ---------------------------------------------------------------- windows

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    resizable: false,
    maximizable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    title: 'PC-Bridge',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  startup.log('window:create', { rendererPath, exists: fs.existsSync(rendererPath) });

  mainWindow.loadFile(rendererPath).then(
    () => startup.log('window:loaded'),
    (error) => startup.log('window:load-failed', { message: error.message }),
  );

  // Never depend on a single event to become visible: show as soon as the paint is
  // ready, and unconditionally after a short fallback in case the renderer stalls.
  mainWindow.once('ready-to-show', () => {
    startup.log('window:ready-to-show');
    mainWindow.show();
  });
  setTimeout(() => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      startup.log('window:forced-show');
      mainWindow.show();
    }
  }, 2500);

  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    startup.log('window:did-fail-load', { code, description });
  });
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    startup.log('renderer:console', { level, message: String(message).slice(0, 300) });
  });

  // Closing the window only hides it: the bridge must keep running.
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.on('render-process-gone', () => {
    state.journal.push('ui', 'рендерер упал — перезапускаю окно');
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
  });
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 48,
    height: 48,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWindow.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
}

function cursorApi() {
  return {
    get() {
      return [virtualCursor.x, virtualCursor.y];
    },
    set(x, y) {
      virtualCursor = { x, y };
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      overlayWindow.setPosition(x - 24, y - 24, false);
      if (!overlayWindow.isVisible()) overlayWindow.showInactive();
    },
    pulse() {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('pulse');
      }
    },
  };
}

function overlayVisible(visible) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (visible) {
    overlayWindow.setPosition(virtualCursor.x - 24, virtualCursor.y - 24, false);
    overlayWindow.showInactive();
  } else {
    overlayWindow.hide();
  }
}

// ---------------------------------------------------------------- chat panel

function browserCandidates() {
  return [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
}

/** Tiles the launcher to the left half and returns the geometry for the right half. */
function stretchLauncher() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const bounds = mainWindow.getBounds();
  launcherGeometry = { ...bounds };

  const leftWidth = Math.round(width / 2);
  const rightWidth = width - leftWidth;
  const windowHeight = Math.min(800, height);
  const top = Math.round((height - windowHeight) / 2);

  mainWindow.setBounds({ x: 0, y: top, width: leftWidth, height: windowHeight });
  return { x: leftWidth, y: top, width: rightWidth, height: windowHeight };
}

function restoreLauncher() {
  if (launcherGeometry && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBounds(launcherGeometry);
    launcherGeometry = null;
  }
}

function openChatInBrowser() {
  const area = stretchLauncher();
  const args = [
    '--new-window',
    `--window-position=${area.x},${area.y}`,
    `--window-size=${area.width},${area.height}`,
    CHAT_URL,
  ];
  const candidate = browserCandidates().find((file) => fs.existsSync(file));
  if (candidate) {
    execFile(candidate, args, { windowsHide: true }, (error) => {
      if (error) state.journal.push('error', `браузер не запустился: ${error.message}`);
    });
    state.journal.push('ui', 'чат открыт в браузере рядом с лаунчером');
    return { ok: true, mode: 'browser' };
  }
  shell.openExternal(CHAT_URL);
  state.journal.push('ui', 'чат открыт в системном браузере');
  return { ok: true, mode: 'external' };
}

function openChatInApp() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show();
    chatWindow.focus();
    return { ok: true, mode: 'app' };
  }
  const area = stretchLauncher();
  chatWindow = new BrowserWindow({
    ...area,
    title: 'Arena.ai — Agent Mode',
    autoHideMenuBar: true,
    webPreferences: {
      // A dedicated partition keeps the login session across restarts.
      partition: 'persist:arena-chat',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  chatWindow.loadURL(CHAT_URL).catch(() => {
    state.journal.push('error', 'страница чата не загрузилась — откройте её в браузере');
  });
  chatWindow.on('closed', () => {
    chatWindow = null;
    restoreLauncher();
  });
  state.journal.push('ui', 'чат открыт в отдельном окне приложения');
  return { ok: true, mode: 'app' };
}

// ---------------------------------------------------------------- app lifecycle

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    startup.log('app:ready');
    if (process.platform !== 'win32') {
      state.journal.push('error', 'PC-Bridge рассчитан на Windows: Win32-функции недоступны');
    }

    try {
      createMainWindow();
      startup.log('main-window:created');
      createOverlayWindow();
      startup.log('overlay-window:created');
    } catch (error) {
      startup.log('windows:failed', { message: error.message, stack: error.stack });
      throw error;
    }

    const journalContext = {
      ...state,
      journal: state.journal,
    };

    relay = createRelay({
      version: VERSION,
      hostname: state.hostname,
      startedAt: state.startedAt,
      journal: state.journal,
      windows: () => {
        try {
          windowsCache = win32.listWindows();
        } catch {
          /* non-Windows */
        }
        return windowsCache;
      },
      getKey: () => state.key,
      isActive: () => state.active,
      getTunnelUrl: () => state.tunnel?.url || null,
      countCommand: () => {
        state.commands += 1;
        broadcastSnapshot();
      },
      countNote: () => {
        state.notes += 1;
        broadcastSnapshot();
      },
      ...journalContext,
      overlayVisible,
      cursor: cursorApi(),
    });

    const port = await relay.listen();
    state.port = port;
    startup.log('relay:listening', { port });
    state.journal.push('relay', `релей слушает 127.0.0.1:${port}`);

    tunnel = new Tunnel(state.journal);
    state.tunnel = tunnel;
    startup.log('tunnel:starting');
    tunnel.on('url', () => {
      writeKeyFile();
      broadcastSnapshot();
    });
    tunnel.start(port);

    state.journal.on('entry', (entry) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('journal', entry);
      }
      broadcastSnapshot();
    });

    watchWindows();
    createTray();
    writeKeyFile();
    startup.log('app:started');

    if (state.journal.stage) broadcastSnapshot();
  });

  app.on('window-all-closed', () => {
    // Tray-resident app: keep running until "Выход" is pressed.
  });
}

let windowsTimer = null;
let windowsCache = [];

/** Keeps a warm cache so `GET /windows` answers instantly. */
function watchWindows() {
  clearInterval(windowsTimer);
  windowsTimer = setInterval(() => {
    try {
      windowsCache = win32.listWindows();
    } catch {
      windowsCache = [];
    }
  }, 5000);
}

function createTray() {
  const candidates = [
    path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    path.join(process.resourcesPath || '', 'app.asar', 'build', 'icon.ico'),
  ];
  let icon = nativeImage.createEmpty();
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const loaded = nativeImage.createFromPath(candidate);
    if (!loaded.isEmpty()) {
      icon = loaded;
      startup.log('tray:icon', { source: candidate });
      break;
    }
  }
  if (icon.isEmpty()) startup.log('tray:icon-missing', { candidates });

  try {
    tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('PC-Bridge — мост к вашему ПК');
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: 'Показать окно',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]));
    tray.on('double-click', () => {
      mainWindow.show();
      mainWindow.focus();
    });
    startup.log('tray:ready');
  } catch (error) {
    // A tray that cannot be created must not take the whole bridge down.
    startup.log('tray:failed', { message: error.message });
    tray = null;
  }
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('snapshot', () => snapshot());
  ipcMain.handle('journalTail', (_event, limit = 200) => state.journal.recent(limit));

  ipcMain.handle('setActive', (_event, active) => {
    state.active = Boolean(active);
    state.journal.push('agent', state.active ? 'агент возобновлён' : 'агент поставлен на паузу');
    broadcastSnapshot();
    return snapshot();
  });

  ipcMain.handle('rotateKey', () => {
    state.key = generateKey();
    writeKeyFile();
    state.journal.push('key', 'ключ перегенерирован — старый отозван');
    broadcastSnapshot();
    return pairingBlock({ url: state.tunnel?.url, key: state.key });
  });

  ipcMain.handle('pairingBundle', () => pairingBundle());

  ipcMain.handle('restartTunnel', () => {
    tunnel.restart(state.port);
    return true;
  });

  ipcMain.handle('refreshWindows', () => win32.listWindows());
  ipcMain.handle('activateWindow', (_event, hwnd) => win32.activateWindow(hwnd));
  ipcMain.handle('closeWindow', (_event, hwnd) => win32.closeWindow(hwnd));

  ipcMain.handle('screenshot', () => {
    const shot = agent.handleScreenshot({ journal: state.journal });
    return shot.image_base64 || '';
  });

  ipcMain.handle('openChat', () => openChatInApp());
  ipcMain.handle('openChatBrowser', () => openChatInBrowser());
  ipcMain.handle('chatIsOpen', () => Boolean(chatWindow && !chatWindow.isDestroyed()));

  ipcMain.handle('beginDrag', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    const handle = window.getNativeWindowHandle();
    const hwnd = handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
    return win32.beginWindowDrag(hwnd);
  });

  ipcMain.handle('openDataDir', () => {
    shell.openPath(paths.dataDir());
    return true;
  });

  ipcMain.handle('quit', () => {
    state.journal.push('agent', 'закрытие из окна лаунчера');
    app.isQuitting = true;
    app.quit();
  });
}

app.on('before-quit', () => {
  app.isQuitting = true;
  tunnel?.stop();
  relay?.close();
});

registerIpc();

module.exports = { state };

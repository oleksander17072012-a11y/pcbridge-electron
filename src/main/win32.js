'use strict';

/**
 * Win32 layer through FFI (koffi).
 *
 * Electron has no built-in access to user32/gdi32, so window enumeration, screen
 * capture and the background-input trick are all bound here. Everything is lazily
 * initialised: on a non-Windows machine (CI lint, unit tests) the module loads and
 * simply reports `available === false`.
 */

const IS_WINDOWS = process.platform === 'win32';

let koffi = null;
let available = false;
let api = null;

const WM = {
  CLOSE: 0x0010,
  MOUSEMOVE: 0x0200,
  LBUTTONDOWN: 0x0201,
  LBUTTONUP: 0x0202,
  LBUTTONDBLCLK: 0x0203,
  RBUTTONDOWN: 0x0204,
  RBUTTONUP: 0x0205,
  MBUTTONDOWN: 0x0207,
  MBUTTONUP: 0x0208,
  MOUSEWHEEL: 0x020a,
  KEYDOWN: 0x0100,
  KEYUP: 0x0101,
  CHAR: 0x0102,
  SYSKEYDOWN: 0x0104,
  SYSKEYUP: 0x0105,
  NCLBUTTONDOWN: 0x00a1,
};

const MK = { LBUTTON: 0x0001, RBUTTON: 0x0002, MBUTTON: 0x0010 };

const VK = {
  BACK: 0x08,
  TAB: 0x09,
  RETURN: 0x0d,
  SHIFT: 0x10,
  CONTROL: 0x11,
  MENU: 0x12,
  PAUSE: 0x13,
  CAPITAL: 0x14,
  ESCAPE: 0x1b,
  SPACE: 0x20,
  PRIOR: 0x21,
  NEXT: 0x22,
  END: 0x23,
  HOME: 0x24,
  LEFT: 0x25,
  UP: 0x26,
  RIGHT: 0x27,
  DOWN: 0x28,
  SNAPSHOT: 0x2c,
  INSERT: 0x2d,
  DELETE: 0x2e,
  LWIN: 0x5b,
  RWIN: 0x5c,
  F1: 0x70,
};

const KEY_ALIASES = {
  enter: VK.RETURN,
  return: VK.RETURN,
  tab: VK.TAB,
  space: VK.SPACE,
  backspace: VK.BACK,
  delete: VK.DELETE,
  del: VK.DELETE,
  esc: VK.ESCAPE,
  escape: VK.ESCAPE,
  shift: VK.SHIFT,
  ctrl: VK.CONTROL,
  control: VK.CONTROL,
  alt: VK.MENU,
  win: VK.LWIN,
  super: VK.LWIN,
  meta: VK.LWIN,
  left: VK.LEFT,
  right: VK.RIGHT,
  up: VK.UP,
  down: VK.DOWN,
  home: VK.HOME,
  end: VK.END,
  pageup: VK.PRIOR,
  pagedown: VK.NEXT,
  insert: VK.INSERT,
  capslock: VK.CAPITAL,
  pause: VK.PAUSE,
  printscreen: VK.SNAPSHOT,
};

function load() {
  if (api || !IS_WINDOWS) return api;
  try {
    koffi = require('koffi');
  } catch {
    available = false;
    return null;
  }

  try {
    koffi.struct('POINT', { x: 'int32', y: 'int32' });
    koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    koffi.struct('BITMAPINFOHEADER', {
      biSize: 'uint32',
      biWidth: 'int32',
      biHeight: 'int32',
      biPlanes: 'uint16',
      biBitCount: 'uint16',
      biCompression: 'uint32',
      biSizeImage: 'uint32',
      biXPelsPerMeter: 'int32',
      biYPelsPerMeter: 'int32',
      biClrUsed: 'uint32',
      biClrImportant: 'uint32',
    });
    koffi.struct('BITMAPINFO', { bmiHeader: 'BITMAPINFOHEADER', bmiColors: 'uint32[1]' });

    const user32 = koffi.load('user32.dll');
    const gdi32 = koffi.load('gdi32.dll');
    const kernel32 = koffi.load('kernel32.dll');

    api = {
      EnumWindows: user32.func('int __stdcall EnumWindows(void *callback, intptr lparam)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr hwnd, _Out_ uint16_t *text, int maxCount)'),
      IsWindowVisible: user32.func('int __stdcall IsWindowVisible(intptr hwnd)'),
      IsWindow: user32.func('int __stdcall IsWindow(intptr hwnd)'),
      IsIconic: user32.func('int __stdcall IsIconic(intptr hwnd)'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint32_t *pid)'),
      GetForegroundWindow: user32.func('intptr __stdcall GetForegroundWindow()'),
      GetAncestor: user32.func('intptr __stdcall GetAncestor(intptr hwnd, uint32 flags)'),
      ScreenToClient: user32.func('int __stdcall ScreenToClient(intptr hwnd, _Inout_ POINT *point)'),
      GetClientRect: user32.func('int __stdcall GetClientRect(intptr hwnd, _Out_ RECT *rect)'),
      WindowFromPoint: user32.func('intptr __stdcall WindowFromPoint(POINT point)'),
      PostMessageW: user32.func('int __stdcall PostMessageW(intptr hwnd, uint32 message, uintptr wparam, intptr lparam)'),
      SendMessageW: user32.func('intptr __stdcall SendMessageW(intptr hwnd, uint32 message, uintptr wparam, intptr lparam)'),
      ShowWindow: user32.func('int __stdcall ShowWindow(intptr hwnd, int cmd)'),
      SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(intptr hwnd)'),
      GetSystemMetrics: user32.func('int __stdcall GetSystemMetrics(int index)'),
      GetDC: user32.func('intptr __stdcall GetDC(intptr hwnd)'),
      ReleaseDC: user32.func('int __stdcall ReleaseDC(intptr hwnd, intptr hdc)'),
      VkKeyScanW: user32.func('int16 __stdcall VkKeyScanW(uint16 ch)'),
      MapVirtualKeyW: user32.func('uint32 __stdcall MapVirtualKeyW(uint32 code, uint32 mapType)'),
      ReleaseCapture: user32.func('int __stdcall ReleaseCapture()'),
      CreateCompatibleDC: gdi32.func('intptr __stdcall CreateCompatibleDC(intptr hdc)'),
      CreateCompatibleBitmap: gdi32.func('intptr __stdcall CreateCompatibleBitmap(intptr hdc, int width, int height)'),
      SelectObject: gdi32.func('intptr __stdcall SelectObject(intptr hdc, intptr object)'),
      BitBlt: gdi32.func('int __stdcall BitBlt(intptr dest, int x, int y, int width, int height, intptr src, int sx, int sy, uint32 rop)'),
      GetDIBits: gdi32.func('int __stdcall GetDIBits(intptr hdc, intptr bitmap, uint32 start, uint32 lines, _Out_ uint8_t *bits, _Inout_ BITMAPINFO *info, uint32 usage)'),
      DeleteObject: gdi32.func('int __stdcall DeleteObject(intptr object)'),
      DeleteDC: gdi32.func('int __stdcall DeleteDC(intptr hdc)'),
      OpenProcess: kernel32.func('intptr __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)'),
      QueryFullProcessImageNameW: kernel32.func('int __stdcall QueryFullProcessImageNameW(intptr process, uint32 flags, _Out_ uint16_t *name, _Inout_ uint32_t *size)'),
      CloseHandle: kernel32.func('int __stdcall CloseHandle(intptr handle)'),
    };
    available = true;
  } catch {
    available = false;
    api = null;
  }
  return api;
}

// ---------------------------------------------------------------- windows

function windowTitle(hwnd) {
  const buffer = Buffer.alloc(512 * 2);
  const length = api.GetWindowTextW(hwnd, buffer, 512);
  if (length <= 0) return '';
  return buffer.toString('utf16le', 0, length * 2);
}

function processName(pid) {
  if (!pid) return '';
  const handle = api.OpenProcess(0x1000, 0, pid);
  if (!handle) return '';
  try {
    const buffer = Buffer.alloc(1024 * 2);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(1024, 0);
    if (!api.QueryFullProcessImageNameW(handle, 0, buffer, size)) return '';
    const length = size.readUInt32LE(0);
    const full = buffer.toString('utf16le', 0, length * 2);
    return full.split('\\').pop() || '';
  } finally {
    api.CloseHandle(handle);
  }
}

function describe(hwnd) {
  const title = windowTitle(hwnd);
  if (!title) return null;
  const pidBuffer = Buffer.alloc(4);
  api.GetWindowThreadProcessId(hwnd, pidBuffer);
  const pid = pidBuffer.readUInt32LE(0);
  return { hwnd, title, pid, process: processName(pid) };
}

/** Visible top-level windows with a title, capped at 120 entries. */
function listWindows() {
  if (!load()) return [];
  const seen = [];
  const proto = koffi.proto('int __stdcall EnumWindowsProc(intptr hwnd, intptr lparam)');
  const callback = koffi.register((hwnd) => {
    if (!api.IsWindowVisible(hwnd)) return 1;
    const info = describe(hwnd);
    if (info) seen.push(info);
    return 1;
  }, koffi.pointer(proto));
  try {
    api.EnumWindows(callback, 0);
  } finally {
    koffi.unregister(callback);
  }
  return seen.slice(0, 120);
}

function activeWindow() {
  if (!load()) return { hwnd: 0, title: '', pid: 0, process: '' };
  const hwnd = api.GetForegroundWindow();
  return describe(hwnd) || { hwnd, title: '', pid: 0, process: '' };
}

function closeWindow(hwnd) {
  if (!load() || !hwnd) return false;
  if (!api.IsWindow(hwnd)) return false;
  return api.PostMessageW(hwnd, WM.CLOSE, 0, 0) !== 0;
}

function activateWindow(hwnd) {
  if (!load() || !hwnd) return false;
  if (!api.IsWindow(hwnd)) return false;
  if (api.IsIconic(hwnd)) api.ShowWindow(hwnd, 9);
  return api.SetForegroundWindow(hwnd) !== 0;
}

function screenSize() {
  if (!load()) return { width: 1920, height: 1080 };
  return { width: api.GetSystemMetrics(0), height: api.GetSystemMetrics(1) };
}

// ---------------------------------------------------------------- screen capture

/**
 * Captures the primary screen and returns raw BGRA pixels plus the size, so the
 * caller can encode them with Electron's nativeImage (no image library needed).
 */
function captureScreen(maxWidth = 1280) {
  if (!load()) throw new Error('Win32 недоступен: захват экрана возможен только на Windows');
  const { width, height } = screenSize();
  if (width <= 0 || height <= 0) throw new Error('не удалось определить размер экрана');

  const screen = api.GetDC(0);
  const memory = api.CreateCompatibleDC(screen);
  const bitmap = api.CreateCompatibleBitmap(screen, width, height);
  if (!memory || !bitmap) {
    api.ReleaseDC(0, screen);
    throw new Error('не удалось создать совместимый контекст GDI');
  }
  const previous = api.SelectObject(memory, bitmap);
  try {
    if (!api.BitBlt(memory, 0, 0, width, height, screen, 0, 0, 0x00cc0020)) {
      throw new Error('BitBlt не смог скопировать экран');
    }
    const info = {
      bmiHeader: {
        biSize: 40,
        biWidth: width,
        biHeight: -height,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: 0,
        biSizeImage: 0,
        biXPelsPerMeter: 0,
        biYPelsPerMeter: 0,
        biClrUsed: 0,
        biClrImportant: 0,
      },
      bmiColors: [0],
    };
    const pixels = Buffer.alloc(width * height * 4);
    if (!api.GetDIBits(memory, bitmap, 0, height, pixels, info, 0)) {
      throw new Error('GetDIBits не вернул пиксели');
    }
    const scale = width > maxWidth ? maxWidth / width : 1;
    return {
      width,
      height,
      pixels,
      targetWidth: Math.max(160, Math.round(width * scale)),
      targetHeight: Math.max(1, Math.round(height * scale)),
    };
  } finally {
    api.SelectObject(memory, previous);
    api.DeleteObject(bitmap);
    api.DeleteDC(memory);
    api.ReleaseDC(0, screen);
  }
}

// ---------------------------------------------------------------- background input

function packPoint(x, y) {
  return ((y & 0xffff) << 16) | (x & 0xffff);
}

function toSigned32(value) {
  return value | 0;
}

function hwndAt(x, y) {
  if (!load()) return 0;
  const hwnd = api.WindowFromPoint({ x, y });
  if (!hwnd || !api.IsWindow(hwnd) || !api.IsWindowVisible(hwnd)) return 0;
  return hwnd;
}

function post(hwnd, message, wparam, lparam) {
  if (!hwnd) return false;
  return api.PostMessageW(hwnd, message, wparam, toSigned32(lparam)) !== 0;
}

function clientLparam(hwnd, x, y, requireInside) {
  const point = { x, y };
  if (!api.ScreenToClient(hwnd, point)) throw new Error('не удалось преобразовать координаты окна');
  if (requireInside) {
    const rect = { left: 0, top: 0, right: 0, bottom: 0 };
    if (!api.GetClientRect(hwnd, rect)) throw new Error('не удалось получить клиентскую область окна');
    const inside = point.x >= 0 && point.y >= 0 && point.x < rect.right && point.y < rect.bottom;
    if (!inside) {
      throw new Error('эта точка находится вне клиентской области окна; заголовки/рамки не поддерживаются');
    }
  }
  return packPoint(point.x, point.y);
}

function postMouse(hwnd, message, wparam, x, y, requireInside) {
  if (!api.IsWindow(hwnd)) throw new Error('целевое окно закрылось или недоступно');
  const lparam = clientLparam(hwnd, x, y, requireInside);
  if (!post(hwnd, message, wparam, lparam)) {
    throw new Error(`Windows отклонила фоновое сообщение для окна ${hwnd}`);
  }
}

const BUTTONS = {
  left: [WM.LBUTTONDOWN, WM.LBUTTONUP, MK.LBUTTON],
  primary: [WM.LBUTTONDOWN, WM.LBUTTONUP, MK.LBUTTON],
  right: [WM.RBUTTONDOWN, WM.RBUTTONUP, MK.RBUTTON],
  secondary: [WM.RBUTTONDOWN, WM.RBUTTONUP, MK.RBUTTON],
  middle: [WM.MBUTTONDOWN, WM.MBUTTONUP, MK.MBUTTON],
};

function mouseSpec(button) {
  return BUTTONS[button] || null;
}

function keyCodes(key) {
  const name = String(key || '').trim().toLowerCase();
  if (KEY_ALIASES[name] != null) return { vk: KEY_ALIASES[name], modifiers: [] };

  const functionKey = /^f(\d{1,2})$/.exec(name);
  if (functionKey) {
    const number = Number(functionKey[1]);
    if (number >= 1 && number <= 24) return { vk: VK.F1 + number - 1, modifiers: [] };
  }

  const chars = [...String(key || '')];
  if (chars.length === 1) {
    const scan = api.VkKeyScanW(chars[0].charCodeAt(0));
    if (scan !== -1) {
      const vk = scan & 0xff;
      const state = (scan >> 8) & 0xff;
      const modifiers = [];
      if (state & 1) modifiers.push(VK.SHIFT);
      if (state & 2) modifiers.push(VK.CONTROL);
      if (state & 4) modifiers.push(VK.MENU);
      return { vk, modifiers };
    }
  }
  return null;
}

function postKey(hwnd, vk, down) {
  const scan = api.MapVirtualKeyW(vk, 0);
  let lparam = 1 | (scan << 16);
  if (!down) lparam |= 0xc0000000;
  const message = vk === VK.MENU
    ? (down ? WM.SYSKEYDOWN : WM.SYSKEYUP)
    : (down ? WM.KEYDOWN : WM.KEYUP);
  return post(hwnd, message, vk, lparam);
}

function postChar(hwnd, unit) {
  return post(hwnd, WM.CHAR, unit, 1);
}

function postWheelRoot(hwnd, x, y, clicks) {
  const root = api.GetAncestor(hwnd, 2) || hwnd;
  const delta = Math.max(-1200, Math.min(1200, clicks * 120));
  const wparam = ((delta & 0xffff) << 16) >>> 0;
  if (!post(root, WM.MOUSEWHEEL, wparam, packPoint(x, y))) {
    throw new Error('фоновая прокрутка не выполнена');
  }
}

/** Native window move: the system move loop, exactly like a real title bar. */
function beginWindowDrag(hwnd) {
  if (!load() || !hwnd) return false;
  api.ReleaseCapture();
  api.SendMessageW(hwnd, WM.NCLBUTTONDOWN, 2, 0); // HTCAPTION
  return true;
}

module.exports = {
  WM,
  MK,
  VK,
  get available() {
    load();
    return available;
  },
  load,
  listWindows,
  activeWindow,
  closeWindow,
  activateWindow,
  screenSize,
  captureScreen,
  hwndAt,
  post,
  postMouse,
  postKey,
  postChar,
  postWheelRoot,
  mouseSpec,
  keyCodes,
  clientLparam,
  beginWindowDrag,
};

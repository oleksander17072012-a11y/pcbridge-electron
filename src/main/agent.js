'use strict';

const { spawn } = require('node:child_process');
const { nativeImage } = require('electron');

const win32 = require('./win32');
const { runCommand } = require('./shell');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class BackgroundInputError extends Error {}

function number(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Executes one job coming from the relay.
 * Mirrors the Rust implementation: `shell`, `screenshot` and `gui`.
 */
async function handleJob(job, ctx) {
  const type = job.type || 'shell';
  if (type === 'screenshot') return screenshot(ctx);
  if (type === 'gui') return gui(job, ctx);
  return shell(job, ctx);
}

async function shell(job, ctx) {
  const command = String(job.command || '');
  if (!command.trim()) return { error: 'no command', exit_code: 400 };
  const timeout = Math.max(1, Math.min(600, number(job.timeout, 110)));

  ctx.journal.push('shell', `$ ${command.slice(0, 300)}`);
  const { output, exitCode } = await runCommand(command, job.shell, timeout, spawn);
  ctx.journal.push('shell', `exit=${exitCode} · ${output.trim().slice(0, 240) || 'без вывода'}`);
  return { output, exit_code: exitCode, host: ctx.hostname };
}

function screenshot(ctx) {
  try {
    const shot = win32.captureScreen(1280);
    const image = nativeImage.createFromBitmap(shot.pixels, {
      width: shot.width,
      height: shot.height,
      scaleFactor: 1,
    });
    const resized = shot.targetWidth === shot.width
      ? image
      : image.resize({ width: shot.targetWidth, quality: 'good' });
    const active = win32.activeWindow();
    return {
      image_base64: resized.toJPEG(72).toString('base64'),
      screen_width: shot.width,
      screen_height: shot.height,
      active_window: { title: active.title, process: active.process, hwnd: active.hwnd },
      exit_code: 0,
    };
  } catch (error) {
    return { screenshot_error: error.message, exit_code: 1 };
  }
}

async function gui(job, ctx) {
  const actions = Array.isArray(job.actions) ? job.actions : [];
  if (!actions.length) {
    return { output: "[error] gui job needs a non-empty 'actions' list", exit_code: 400 };
  }
  ctx.journal.push('gui', `${actions.length} действие(й); системный курсор не перемещается`);
  ctx.overlayVisible(true);

  let done = 0;
  try {
    for (const action of actions) {
      const [cursorX, cursorY] = ctx.cursor.get();
      if (cursorX < 10 && cursorY < 10) {
        return { output: '[aborted] failsafe: виртуальный курсор в левом верхнем углу', exit_code: 130, actions_done: done };
      }
      const name = action.action || action.type || '';
      try {
        await runAction(name, action, cursorX, cursorY, ctx);
        done += 1;
        await sleep(50);
      } catch (error) {
        if (error instanceof BackgroundInputError) {
          return { output: `[unsupported/background input] ${error.message}`, exit_code: 95, actions_done: done };
        }
        return { output: `[error] action #${done} ('${name}') failed: ${error.message}`, exit_code: 1, actions_done: done };
      }
    }
    return { output: `ok: ${done} background gui action(s); system cursor untouched`, exit_code: 0, actions_done: done };
  } finally {
    await sleep(400);
    ctx.overlayVisible(false);
  }
}

async function runAction(name, action, cursorX, cursorY, ctx) {
  switch (name) {
    case 'moveTo':
      await moveTo(ctx, number(action.x, cursorX), number(action.y, cursorY), number(action.duration, 0.3));
      return;
    case 'click':
      await click(ctx, number(action.x, cursorX), number(action.y, cursorY), action.button || 'left', false);
      return;
    case 'doubleClick':
      await click(ctx, number(action.x, cursorX), number(action.y, cursorY), 'left', true);
      return;
    case 'rightClick':
      await click(ctx, number(action.x, cursorX), number(action.y, cursorY), 'right', false);
      return;
    case 'typewrite': {
      const hwnd = targetAt(cursorX, cursorY);
      await typewrite(hwnd, String(action.text ?? ''), number(action.interval, 0.02));
      return;
    }
    case 'hotkey': {
      const hwnd = targetAt(cursorX, cursorY);
      hotkey(hwnd, Array.isArray(action.keys) ? action.keys : []);
      return;
    }
    case 'press': {
      const hwnd = targetAt(cursorX, cursorY);
      pressKey(hwnd, String(action.key ?? ''));
      return;
    }
    case 'scroll': {
      const x = number(action.x, cursorX);
      const y = number(action.y, cursorY);
      await moveTo(ctx, x, y, 0);
      const hwnd = targetAt(x, y);
      win32.postWheelRoot(hwnd, x, y, number(action.clicks, 0));
      return;
    }
    case 'dragTo':
      await dragTo(ctx, number(action.x, cursorX), number(action.y, cursorY), number(action.duration, 0.5), action.button || 'left');
      return;
    case 'wait':
      await sleep(Math.max(0, number(action.seconds, 1)) * 1000);
      return;
    default:
      throw new Error(`unknown action '${name}'`);
  }
}

function targetAt(x, y) {
  const hwnd = win32.hwndAt(x, y);
  if (!hwnd) throw new BackgroundInputError('под виртуальным курсором нет видимого окна');
  return hwnd;
}

async function moveTo(ctx, x, y, duration) {
  const [startX, startY] = ctx.cursor.get();
  const clamped = Math.max(0, Math.min(4, duration));
  const steps = Math.max(1, Math.min(50, Math.round(clamped * 30)));
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    const px = Math.round(startX + (x - startX) * ratio);
    const py = Math.round(startY + (y - startY) * ratio);
    ctx.cursor.set(px, py);
    const hwnd = win32.hwndAt(px, py);
    if (hwnd) {
      try {
        win32.postMouse(hwnd, win32.WM.MOUSEMOVE, 0, px, py, false);
      } catch {
        /* the window may vanish mid-move */
      }
    }
    if (clamped > 0) await sleep((clamped * 1000) / steps);
  }
}

async function click(ctx, x, y, button, double) {
  ctx.cursor.set(x, y);
  const hwnd = targetAt(x, y);
  const spec = win32.mouseSpec(button);
  if (!spec) throw new BackgroundInputError(`неподдерживаемая кнопка мыши: ${button}`);
  const [down, up, state] = spec;

  win32.postMouse(hwnd, win32.WM.MOUSEMOVE, 0, x, y, false);
  const lparam = win32.clientLparam(hwnd, x, y, true);
  if (!win32.post(hwnd, down, state, lparam)) throw new BackgroundInputError('фоновое нажатие не отправлено');
  ctx.cursor.pulse();
  await sleep(60);

  if (double && (button === 'left' || button === 'primary')) {
    win32.post(hwnd, up, 0, lparam);
    await sleep(80);
    win32.post(hwnd, win32.WM.LBUTTONDBLCLK, state, lparam);
    ctx.cursor.pulse();
    await sleep(50);
    win32.post(hwnd, up, 0, lparam);
  } else {
    win32.post(hwnd, up, 0, lparam);
  }
}

function pressKey(hwnd, key) {
  const codes = win32.keyCodes(key);
  if (!codes) throw new BackgroundInputError(`неподдерживаемая клавиша: ${key}`);
  const held = [];
  for (const modifier of codes.modifiers) {
    win32.postKey(hwnd, modifier, true);
    held.push(modifier);
  }
  win32.postKey(hwnd, codes.vk, true);
  held.push(codes.vk);
  for (const code of held.reverse()) win32.postKey(hwnd, code, false);
}

async function typewrite(hwnd, text, interval) {
  const pause = Math.max(0, Math.min(1, interval));
  for (const character of text) {
    if (character === '\n') {
      pressKey(hwnd, 'enter');
    } else if (character === '\r') {
      /* skip */
    } else if (character === '\t') {
      pressKey(hwnd, 'tab');
    } else {
      // Surrogate pairs must be posted as two WM_CHAR halves.
      for (let index = 0; index < character.length; index += 1) {
        if (!win32.postChar(hwnd, character.charCodeAt(index))) {
          throw new BackgroundInputError('не удалось отправить текст в окно');
        }
      }
    }
    if (pause > 0) await sleep(pause * 1000);
  }
}

function hotkey(hwnd, keys) {
  if (!keys.length) throw new BackgroundInputError('hotkey требует непустой список keys');
  const explicit = [];
  const implicit = [];
  for (const key of keys) {
    const codes = win32.keyCodes(key);
    if (!codes) throw new BackgroundInputError(`неподдерживаемая клавиша: ${key}`);
    explicit.push(codes.vk);
    implicit.push(...codes.modifiers);
  }
  const modifierSet = [win32.VK.SHIFT, win32.VK.CONTROL, win32.VK.MENU, win32.VK.LWIN, win32.VK.RWIN];
  const sequence = [];
  for (const code of explicit.filter((code) => modifierSet.includes(code))) {
    if (!sequence.includes(code)) sequence.push(code);
  }
  for (const code of implicit) {
    if (!sequence.includes(code)) sequence.push(code);
  }
  for (const code of explicit) {
    if (!sequence.includes(code)) sequence.push(code);
  }
  for (const code of sequence) win32.postKey(hwnd, code, true);
  for (const code of sequence.reverse()) win32.postKey(hwnd, code, false);
}

async function dragTo(ctx, endX, endY, duration, button) {
  const [startX, startY] = ctx.cursor.get();
  const hwnd = targetAt(startX, startY);
  const spec = win32.mouseSpec(button);
  if (!spec) throw new BackgroundInputError(`неподдерживаемая кнопка перетаскивания: ${button}`);
  const [down, up, state] = spec;

  win32.postMouse(hwnd, win32.WM.MOUSEMOVE, 0, startX, startY, false);
  const startParams = win32.clientLparam(hwnd, startX, startY, true);
  if (!win32.post(hwnd, down, state, startParams)) throw new BackgroundInputError('фоновое перетаскивание не началось');
  ctx.cursor.pulse();

  const clamped = Math.max(0, Math.min(4, duration));
  const steps = Math.max(1, Math.min(50, Math.round(clamped * 30)));
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    const px = Math.round(startX + (endX - startX) * ratio);
    const py = Math.round(startY + (endY - startY) * ratio);
    ctx.cursor.set(px, py);
    try {
      win32.postMouse(hwnd, win32.WM.MOUSEMOVE, state, px, py, false);
    } catch {
      break;
    }
    if (clamped > 0) await sleep((clamped * 1000) / steps);
  }
  ctx.cursor.set(endX, endY);
  const endParams = win32.clientLparam(hwnd, endX, endY, false);
  win32.post(hwnd, up, 0, endParams);
}

module.exports = { handleJob, handleShell: shell, handleScreenshot: screenshot, handleGui: gui, BackgroundInputError };

'use strict';

const $ = (id) => document.getElementById(id);
const api = window.bridge;

let state = null;
let entries = [];
let keyVisible = false;
let dragging = false;
let toastTimer = null;

function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 3000);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
  ));
}

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours) return `${hours} ч ${minutes} мин`;
  if (minutes) return `${minutes} мин ${rest} с`;
  return `${rest} с`;
}

// ---------------------------------------------------------------- title bar
$('dragZone').addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  dragging = true;
  api.beginDrag();
  setTimeout(() => { dragging = false; }, 500);
});
$('tbMin').addEventListener('click', () => api.minimize());
$('tbClose').addEventListener('click', () => api.close());

// ---------------------------------------------------------------- pairing
function pairingView() {
  const block = state?.pairing || '';
  if (!block || keyVisible) return block;
  return block.replace(/key=([0-9a-f]{4})[0-9a-f]+([0-9a-f]{4})/i, 'key=$1••••••••••••$2');
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
  }
  toast(message);
}

$('copyBtn').addEventListener('click', async () => {
  try {
    await copyText(await api.pairingBundle(), 'Скопировано: ключ + промпт');
  } catch {
    await copyText(state?.pairing || '', 'Скопирован только ключ');
  }
  try {
    await api.openChatBrowser();
    toast('Ключ скопирован, чат открыт справа');
  } catch (error) {
    toast(`Не удалось открыть чат: ${error}`);
  }
});

$('copyKeyBtn').addEventListener('click', () => copyText(state?.pairing || '', 'Скопирован только блок ключа'));
$('chatBrowserBtn').addEventListener('click', async () => {
  await api.openChatBrowser();
  toast('Чат открыт в браузере');
});
$('chatBtn').addEventListener('click', async () => {
  const open = await api.chatIsOpen();
  if (open) {
    toast('Окно чата уже открыто');
    return;
  }
  await api.openChat();
  toast('Чат открыт в окне приложения');
});

$('revealBtn').addEventListener('click', () => {
  keyVisible = !keyVisible;
  $('pairing').value = pairingView();
  $('revealBtn').textContent = keyVisible ? 'Скрыть ключ' : 'Показать ключ';
});

$('rotateBtn').addEventListener('click', async () => {
  if (!confirm('Сгенерировать новый ключ? Старый мгновенно перестанет работать.')) return;
  await api.rotateKey();
  toast('Новый ключ создан, старый отозван');
  refresh();
});

$('tunnelBtn').addEventListener('click', async () => {
  await api.restartTunnel();
  toast('Туннель перезапускается…');
});

// ---------------------------------------------------------------- state
function renderState(next) {
  if (!next) return;
  state = next;
  $('pairing').value = pairingView();
  $('revealBtn').textContent = keyVisible ? 'Скрыть ключ' : 'Показать ключ';

  const tunnelHost = (next.tunnel_url || '').replace(/^https?:\/\//, '');
  $('sTunnel').textContent = tunnelHost || 'нет связи';
  $('sTunnel').title = next.tunnel_url || 'туннель ещё не поднялся';
  $('sTunnel').style.color = next.tunnel_url ? 'var(--green)' : 'var(--red)';
  $('sPort').textContent = next.port ? `127.0.0.1:${next.port}` : '—';
  $('sHost').textContent = next.hostname || '—';
  $('sUptime').textContent = formatUptime(next.uptime_seconds);
  $('sCounters').textContent = `${next.commands || 0} / ${next.notes || 0}`;
  $('sAdmin').textContent = next.elevated ? 'администратор' : 'пользователь';
  $('sAdmin').style.color = next.elevated ? 'var(--amber)' : 'var(--muted)';

  $('agentDot').className = `dot ${next.active ? 'on' : 'off'}`;
  $('agentLabel').textContent = next.active ? 'агент активен' : 'пауза';
  $('pauseBtn').textContent = next.active ? 'Пауза' : 'Продолжить';

  $('tunnelDot').className = `dot ${next.tunnel_url ? 'on' : 'wait'}`;
  $('tunnelLabel').textContent = next.tunnel_url ? 'туннель готов' : 'поднимаю туннель';

  const chip = $('stageChip');
  chip.hidden = !next.stage;
  if (next.stage) {
    $('stageLabel').textContent = next.stage;
    chip.title = next.stage;
  }
}

function entryHtml(entry) {
  const glyph = entry.glyph || '·';
  return `<div class="entry ${escapeHtml(entry.kind)}">
    <span class="t">${escapeHtml(entry.time)}</span>
    <span class="g">${escapeHtml(glyph)}</span>
    <span class="m">${escapeHtml(entry.text)}</span>
  </div>`;
}

function renderJournal() {
  const box = $('journal');
  box.innerHTML = entries.map(entryHtml).join('');
  box.scrollTop = box.scrollHeight;
}

function appendEntry(entry) {
  if (!entry) return;
  entries.push(entry);
  if (entries.length > 400) entries = entries.slice(-300);
  renderJournal();
}

async function refresh() {
  if (dragging) return;
  try {
    renderState(await api.snapshot());
  } catch {
    /* window is still starting */
  }
}

async function loadJournal() {
  try {
    entries = await api.journalTail(250);
    renderJournal();
  } catch {
    /* the log appears a moment later */
  }
}

// ---------------------------------------------------------------- actions
$('pauseBtn').addEventListener('click', async () => {
  renderState(await api.setActive(!(state?.active ?? true)));
});

$('shotBtn').addEventListener('click', async () => {
  try {
    const base64 = await api.screenshot();
    if (!base64) throw new Error('пустой ответ');
    $('shotImg').src = `data:image/jpeg;base64,${base64}`;
    $('shotWrap').classList.add('show');
    toast('Скриншот снят');
  } catch (error) {
    toast(`Скриншот не удался: ${error}`);
  }
});

$('folderBtn').addEventListener('click', () => api.openDataDir());
$('quitBtn').addEventListener('click', () => {
  if (confirm('Закрыть PC-Bridge полностью? Мост перестанет работать.')) api.quit();
});

api.onJournal(appendEntry);
api.onState(renderState);

refresh();
loadJournal();
setInterval(refresh, 3000);

// Watchdog: if the main process stops answering, reload instead of showing a stale frame.
let failures = 0;
setInterval(async () => {
  try {
    await api.snapshot();
    failures = 0;
  } catch {
    failures += 1;
    if (failures >= 5) location.reload();
  }
}, 4000);

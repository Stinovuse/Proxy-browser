'use strict';
/*
 * S Browser — Chromium (Electron), выходящий в сеть ТОЛЬКО через прокси.
 *
 * Защита:
 *  - прокси задаётся флагом Chromium + на уровне сессии, без fallback на DIRECT;
 *    если прокси упал — страницы просто не грузятся (kill switch);
 *  - локальный DNS запрещён (host-resolver-rules), кроме адреса самого прокси;
 *  - WebRTC пускается только через прокси, QUIC/UDP отключён;
 *  - localhost и локальная сеть тоже идут через прокси (<-loopback>);
 *  - данные браузера в отдельной папке, file:// заблокирован,
 *    доступ к камере/микрофону/геолокации/USB и т.п. запрещён;
 *  - загрузки сохраняются только в собственную папку приложения;
 *  - часовой пояс подменяется (по умолчанию Сингапур, UTC+8);
 *  - автоперевод страниц и автообновление — тоже только через прокси.
 */
const {
  app, BaseWindow, BrowserWindow, WebContentsView, Menu,
  ipcMain, session, safeStorage, shell, net, clipboard,
} = require('electron');
const path = require('path');
const fs = require('fs');

// ---------- Изолированная папка данных ----------
const APP_NAME = 'S Browser';
app.setName(APP_NAME);
const OLD_DATA_DIR = path.join(app.getPath('appData'), 'ProxyBrowser');
let DATA_DIR = path.join(app.getPath('appData'), 'SBrowser');
// Переезд со старого имени (Proxy Browser): настройки, закладки и cookies сохраняются
if (!fs.existsSync(DATA_DIR) && fs.existsSync(OLD_DATA_DIR)) {
  try { fs.renameSync(OLD_DATA_DIR, DATA_DIR); } catch { DATA_DIR = OLD_DATA_DIR; }
}
fs.mkdirSync(DATA_DIR, { recursive: true });
app.setPath('userData', DATA_DIR);
const CFG_PATH = path.join(DATA_DIR, 'config.json');
const DL_DIR = path.join(DATA_DIR, 'Downloads');

const START_URL = 'https://duckduckgo.com/';
const SEARCH_URL = 'https://duckduckgo.com/?q=';
const IP_CHECK_URL = 'https://api.ipify.org?format=json';
const IP_INFO_URL = 'https://ipwho.is/';
// DNS-сервер, которым пользуется прокси: случайное имя разрешает именно он,
// и сервис видит его адрес и страну. Только http — у бесплатного ip-api нет https.
const DNS_INFO_HOST = 'edns.ip-api.com';
const TOOLBAR_H = 112;
const BM_PATH = path.join(DATA_DIR, 'bookmarks.json');
const PROXY_TYPES = ['http', 'https', 'socks5', 'socks4'];

function readCfg() {
  try { return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); } catch { return null; }
}
const cfg = readCfg();
const configured = !!(cfg && cfg.host && cfg.port && PROXY_TYPES.includes(cfg.type));
const proxyUrl = configured ? `${cfg.type}://${cfg.host}:${cfg.port}` : null;

// ---------- Часовой пояс ----------
const TZ_DEFAULT = 'Asia/Singapore'; // UTC+8
const TZ_RE = /^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+)+)$/;
// Версии до 1.4 по умолчанию ставили Китай — переводим их на Сингапур
const tzStored = cfg && !cfg.tzV2 && cfg.timezone === 'Asia/Shanghai' ? TZ_DEFAULT : cfg && cfg.timezone;
const TIMEZONE = tzStored === 'system' ? 'system'
  : TZ_RE.test(tzStored || '') ? tzStored : TZ_DEFAULT;
if (TIMEZONE !== 'system') process.env.TZ = TIMEZONE; // для процессов Chromium (воркеры и т.п.)

// ---------- Язык браузера по региону часового пояса ----------
// navigator.language(s), Accept-Language и формат дат/чисел (Intl) — как у жителя региона
const TZ_LOCALE = {
  'Asia/Singapore': 'en-SG', 'Asia/Shanghai': 'zh-CN', 'Asia/Hong_Kong': 'zh-HK', 'Asia/Taipei': 'zh-TW',
  'Asia/Kuala_Lumpur': 'ms-MY', 'Asia/Manila': 'en-PH', 'Australia/Perth': 'en-AU', 'UTC': 'en-US',
  'Europe/London': 'en-GB', 'Europe/Berlin': 'de-DE', 'Europe/Moscow': 'ru-RU', 'Asia/Dubai': 'ar-AE',
  'Asia/Tokyo': 'ja-JP', 'America/New_York': 'en-US', 'America/Los_Angeles': 'en-US',
};
const LOCALE_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
function localeForTz(tz) {
  if (TZ_LOCALE[tz]) return TZ_LOCALE[tz];
  if (/^America\//.test(tz)) return 'en-US';
  if (/^Europe\//.test(tz)) return 'en-GB';
  if (/^Australia\//.test(tz)) return 'en-AU';
  return 'en-US';
}
// 'auto' — по часовому поясу, 'system' — без подмены, иначе конкретная локаль
const LANG_MODE = cfg && (cfg.browserLang === 'system' || LOCALE_RE.test(cfg.browserLang || '')) ? cfg.browserLang : 'auto';
const LOCALE = LANG_MODE === 'system' ? null
  : LANG_MODE === 'auto' ? (TIMEZONE === 'system' ? null : localeForTz(TIMEZONE)) : LANG_MODE;
// Список без q-коэффициентов (как в настройках Chrome): navigator.languages = ['en-SG', 'en'],
// а заголовок Accept-Language с q=0.9 Chromium сформирует сам
function acceptLanguageFor(loc) {
  const base = loc.split('-')[0];
  const list = [loc];
  if (base !== loc) list.push(base);
  if (base !== 'en') list.push('en');
  return list.join(',');
}
const ACCEPT_LANG = LOCALE ? acceptLanguageFor(LOCALE) : null;
if (LOCALE) app.commandLine.appendSwitch('lang', LOCALE);

// ---------- Перевод ----------
const TR_LANGS = ['ru', 'en', 'uk', 'zh-CN', 'de', 'fr', 'es', 'it', 'pt', 'ja', 'ko', 'tr', 'ar'];
const TR_AUTO = !cfg || cfg.autoTranslate !== false;
const TR_LANG = (cfg && TR_LANGS.includes(cfg.translateTo)) ? cfg.translateTo : 'ru';
const TR_EXCL_PATH = path.join(DATA_DIR, 'translate-exclude.json');
const TR_URL = 'https://translate.googleapis.com/translate_a/single';

// ---------- Автообновление ----------
const { protect, restore } = require('./lib/protect');
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* в режиме разработки может отсутствовать */ }

// ---------- Флаги Chromium (до app.ready) ----------
if (configured) {
  app.commandLine.appendSwitch('proxy-server', proxyUrl);
  app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>');
  // Запрет любого локального DNS, кроме адреса прокси -> нет DNS-утечек
  app.commandLine.appendSwitch('host-resolver-rules', `MAP * ~NOTFOUND , EXCLUDE ${cfg.host}`);
} else {
  // Прокси не настроен — сеть полностью закрыта
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
  app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:9');
}
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('dns-prefetch-disable');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-features', 'NetworkPrediction,AutofillServerCommunication,MediaRouter');
// Загрузка файла несколькими соединениями: через удалённый прокси заметно быстрее
app.commandLine.appendSwitch('enable-features', 'ParallelDownloading');
// Кэш на диске не нужен: всё, что сайт мог бы туда положить, не сохраняется
const NO_CACHE = !cfg || cfg.noCache !== false;
const BLOCK_3P = !cfg || cfg.block3p !== false;

if (!app.requestSingleInstanceLock()) { app.quit(); }

// Непредвиденные ошибки не роняют браузер, а пишутся в журнал
const LOG_PATH = path.join(DATA_DIR, 'error.log');
// Тест запуска в CI: «S Browser.exe --smoke-test» стартует, ждёт и выходит с кодом 0/1
const SMOKE = process.argv.includes('--smoke-test');
const smokeErrors = [];
function logError(kind, err) {
  if (SMOKE) smokeErrors.push(`${kind}: ${(err && err.stack) || err}`);
  try {
    const line = `[${new Date().toISOString()}] ${kind}: ${(err && err.stack) || err}\n`;
    fs.appendFileSync(LOG_PATH, line);
    if (fs.statSync(LOG_PATH).size > 1_000_000) fs.writeFileSync(LOG_PATH, line);
  } catch {}
}
process.on('uncaughtException', (e) => logError('uncaughtException', e));
process.on('unhandledRejection', (e) => logError('unhandledRejection', e));

// ---------- Пароль прокси (шифруется средствами ОС, если доступно) ----------
function encryptPass(p) {
  if (!p) return null;
  if (safeStorage.isEncryptionAvailable()) return { enc: true, v: safeStorage.encryptString(p).toString('base64') };
  return { enc: false, v: Buffer.from(p, 'utf8').toString('base64') };
}
function decryptPass(o) {
  if (!o) return '';
  try {
    const b = Buffer.from(o.v, 'base64');
    return o.enc ? safeStorage.decryptString(b) : b.toString('utf8');
  } catch { return ''; }
}

// Логин/пароль прокси подставляются автоматически — и для вкладок, и для служебных запросов
const authTries = new WeakMap();
app.on('login', (event, wc, _details, authInfo, callback) => {
  if (!authInfo.isProxy) return; // авторизацию сайтов не трогаем
  event.preventDefault();
  const n = (wc && authTries.get(wc)) || 0;
  if (!configured || !cfg.user || n >= 3) return callback(); // отмена
  if (wc) authTries.set(wc, n + 1);
  callback(cfg.user, decryptPass(cfg.pass));
});

// HTTP-запрос строго через прокси, с авторизацией на прокси.
// (session.fetch не умеет отвечать на запрос пароля прокси — поэтому раньше
// индикатор при запуске показывал «прокси недоступен»)
function proxyRequest(url, { method = 'GET', headers = {}, body = null, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = net.request({ url, method, session: ses, useSessionCookies: false, redirect: 'follow', cache: 'no-store' });
    } catch (e) { return reject(e); }
    let tries = 0;
    req.on('login', (authInfo, cb) => {
      if (authInfo.isProxy && configured && cfg.user && tries++ < 2) cb(cfg.user, decryptPass(cfg.pass));
      else cb();
    });
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
    const timer = setTimeout(() => { try { req.abort(); } catch {} reject(new Error('timeout')); }, timeout);
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }); });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    if (body) req.write(body);
    req.end();
  });
}
async function proxyJson(url, opts) {
  const r = await proxyRequest(url, opts);
  if (r.status === 407) throw new Error('ERR_PROXY_AUTH');
  if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
  return JSON.parse(r.text);
}

// User-Agent как у обычного Chrome: без названия приложения и «Electron»,
// версия в сокращённом виде (Chrome/156.0.0.0), как отправляет настоящий Chrome
function chromeLikeUA(ua) {
  const m = ua.match(/Chrome\/(\d+)/);
  const major = m ? m[1] : process.versions.chrome.split('.')[0];
  const platform = (ua.match(/^Mozilla\/5\.0 \(([^)]+)\)/) || [])[1] || 'Windows NT 10.0; Win64; x64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

// ---------- Сессия ----------
let ses;
async function setupSession() {
  ses = session.fromPartition(cfg.incognito ? 'proxy-temp' : 'persist:proxy');
  await ses.setProxy({ proxyRules: proxyUrl, proxyBypassRules: '<-loopback>' });
  await ses.forceReloadProxyConfig?.();

  // Убираем "Electron" из User-Agent, чтобы выглядеть как обычный Chrome
  if (ACCEPT_LANG) ses.setUserAgent(chromeLikeUA(ses.getUserAgent()), ACCEPT_LANG);
  else ses.setUserAgent(chromeLikeUA(ses.getUserAgent()));

  const allowed = new Set(['fullscreen', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
  ses.setDevicePermissionHandler(() => false);

  // file:// для сайтов закрыт. Раньше это проверялось JS-обработчиком на КАЖДЫЙ запрос;
  // перехват схемы работает внутри сети Chromium и ничего не замедляет.
  ses.protocol.handle('file', () => new Response('Blocked', { status: 403 }));

  // ---------- Кэш ----------
  // Кэш работает в течение сеанса (страницы грузятся быстро), но стирается при каждом
  // запуске: «суперкуки» через кэш/ETag не переживают перезапуск. Между сайтами
  // Chromium и так разделяет кэш, поэтому один сайт не видит, что вы были на другом.
  if (NO_CACHE) await ses.clearCache();

  // ---------- Сторонние cookies ----------
  // Обработчики заголовков вызываются на каждый запрос, поэтому ставим их,
  // только если блокировка включена, и выходим как можно раньше.
  if (BLOCK_3P) {
    ses.webRequest.onBeforeSendHeaders((d, cb) => {
      if (d.resourceType === 'mainFrame') return cb({});
      const h = d.requestHeaders;
      const k = h.Cookie !== undefined ? 'Cookie' : h.cookie !== undefined ? 'cookie' : null;
      if (k && isThirdParty(d)) { delete h[k]; return cb({ requestHeaders: h }); }
      cb({});
    });
    ses.webRequest.onHeadersReceived((d, cb) => {
      if (d.resourceType === 'mainFrame') return cb({});
      const h = d.responseHeaders;
      if (!h) return cb({});
      const k = Object.keys(h).find(x => x.toLowerCase() === 'set-cookie');
      if (k && isThirdParty(d)) { delete h[k]; return cb({ responseHeaders: h }); }
      cb({});
    });
  }

  ses.on('will-download', (_e, item) => trackDownload(item));
}

// ---------- Проверка отправителя IPC ----------
// Команды интерфейса принимаются только от панели браузера, настройки —
// только из окна настроек, перевод — только от вкладок. Взломанная страница
// не сможет, например, подменить прокси через settings:save.
const SETTINGS_CHANNELS = new Set(['settings:get', 'settings:save', 'data:clear']);
const TAB_CHANNELS = new Set(['tr:config', 'tr:translate', 'tr:state']);
function senderAllowed(ch, e) {
  const s = e && e.sender;
  if (!s) return false;
  if (TAB_CHANNELS.has(ch)) return !!tabBySender(s);
  if (SETTINGS_CHANNELS.has(ch)) return !!(settingsWin && !settingsWin.isDestroyed() && s === settingsWin.webContents);
  return !!(ui && !ui.webContents.isDestroyed() && s === ui.webContents);
}
function ipcOn(ch, fn) {
  ipcMain.on(ch, (e, ...a) => {
    if (e && e.sender && !senderAllowed(ch, e)) return logError('ipc-blocked', ch);
    return fn(e, ...a); // e пустой — вызов изнутри главного процесса (ipcMain.emit)
  });
}
function ipcHandle(ch, fn) {
  ipcMain.handle(ch, (e, ...a) => {
    if (!senderAllowed(ch, e)) { logError('ipc-blocked', ch); return null; }
    return fn(e, ...a);
  });
}

// ---------- Загрузки ----------
const downloads = []; // новые сверху
let dlSeq = 0;
let dlSendTimer = null;

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name);
  for (let i = 1; fs.existsSync(p) && i < 1000; i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

function dlPublic(d) {
  return {
    id: d.id, name: d.name, state: d.state, paused: d.paused,
    received: d.received, total: d.total, speed: Math.round(d.speed),
  };
}
function sendDownloads(now = false) {
  const go = () => {
    dlSendTimer = null;
    if (ui && !ui.webContents.isDestroyed()) ui.webContents.send('downloads', downloads.map(dlPublic));
  };
  if (now) { clearTimeout(dlSendTimer); go(); }
  else if (!dlSendTimer) dlSendTimer = setTimeout(go, 250);
}

function trackDownload(item) {
  fs.mkdirSync(DL_DIR, { recursive: true });
  const safeName = path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'download';
  const savePath = uniquePath(DL_DIR, safeName);
  item.setSavePath(savePath);
  const d = {
    id: ++dlSeq, name: path.basename(savePath), path: savePath, item,
    state: 'progressing', paused: false, received: 0, total: item.getTotalBytes(),
    speed: 0, lastBytes: 0, lastTime: Date.now(),
  };
  downloads.unshift(d);
  while (downloads.length > 50) downloads.pop();
  item.on('updated', (_e, state) => {
    const now = Date.now();
    d.received = item.getReceivedBytes();
    d.total = item.getTotalBytes();
    d.paused = item.isPaused();
    d.state = state === 'interrupted' ? 'interrupted' : 'progressing';
    const dt = (now - d.lastTime) / 1000;
    if (dt >= 0.5) {
      const inst = (d.received - d.lastBytes) / dt;
      d.speed = d.speed ? d.speed * 0.6 + inst * 0.4 : inst; // сглаживание
      d.lastBytes = d.received; d.lastTime = now;
    }
    if (d.paused) d.speed = 0;
    sendDownloads();
  });
  item.once('done', (_e, state) => {
    d.state = state; // completed | cancelled | interrupted
    d.received = item.getReceivedBytes();
    d.speed = 0;
    d.item = null;
    sendDownloads(true);
    if (state === 'completed') toast(`Загружено: ${d.name}`);
    else if (state === 'interrupted') toast(`Загрузка не удалась: ${d.name}`);
  });
  sendDownloads(true);
  setDownloadsPanel(true); // как в Chrome: при начале загрузки показываем панель
}

const dlById = (id) => downloads.find(x => x.id === id);
ipcOn('dl:cancel', (_e, id) => { const d = dlById(id); if (d && d.item) d.item.cancel(); });
ipcOn('dl:pause', (_e, id) => {
  const d = dlById(id);
  if (!d || !d.item) return;
  if (d.item.isPaused()) { if (d.item.canResume()) d.item.resume(); } else d.item.pause();
  d.paused = d.item.isPaused();
  sendDownloads(true);
});
ipcOn('dl:retry', (_e, id) => {
  const d = dlById(id);
  if (!d || !d.item) return;
  if (d.item.canResume()) d.item.resume();
});
ipcOn('dl:open', (_e, id) => {
  const d = dlById(id);
  if (d && d.state === 'completed' && fs.existsSync(d.path)) shell.openPath(d.path);
});
ipcOn('dl:show', (_e, id) => {
  const d = dlById(id);
  if (d && fs.existsSync(d.path)) shell.showItemInFolder(d.path);
  else { fs.mkdirSync(DL_DIR, { recursive: true }); shell.openPath(DL_DIR); }
});
ipcOn('dl:clear', () => {
  for (let i = downloads.length - 1; i >= 0; i--) if (downloads[i].state !== 'progressing') downloads.splice(i, 1);
  sendDownloads(true);
});
ipcOn('dl:panel', (_e, open) => setDownloadsPanel(!!open));

// Панель загрузок рисуется в той же панели интерфейса: на время показа
// она растягивается на всё окно (прозрачная) и поднимается поверх страницы
let uiExpanded = false;
function setDownloadsPanel(open) {
  if (!win || win.isDestroyed() || !ui) return;
  uiExpanded = open;
  if (open) win.contentView.addChildView(ui); // наверх
  layout();
  ui.webContents.send('dl:panel', open);
  if (open) ui.webContents.focus();
  else { const t = activeTab(); if (t) t.view.webContents.focus(); }
}

// Упрощённое определение «сайта» (eTLD+1): example.com, example.co.uk
function siteOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    if (/^[\d.]+$/.test(host) || host.includes(':')) return host;
    const p = host.split('.');
    const sld = p[p.length - 2];
    const n = (p.length > 2 && p[p.length - 1].length === 2 &&
      ['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'msk', 'spb'].includes(sld)) ? 3 : 2;
    return p.slice(-n).join('.');
  } catch { return null; }
}
// Сервисы входа («Войти через Google/Apple/…»): им сторонние cookies нужны,
// иначе вход на сайтах ломается. Рекламные и счётчики по-прежнему блокируются.
const SSO_SITES = new Set([
  'google.com', 'googleapis.com', 'gstatic.com', 'firebaseapp.com', 'web.app', 'firebase.com',
  'apple.com', 'icloud.com', 'microsoftonline.com', 'live.com', 'microsoft.com', 'msauth.net', 'msftauth.net',
  'facebook.com', 'github.com', 'x.com', 'twitter.com', 'discord.com', 'telegram.org',
  'yandex.ru', 'yandex.com', 'vk.com', 'mail.ru', 'auth0.com', 'okta.com', 'clerk.com', 'clerk.dev',
  'stytch.com', 'cloudflare.com', 'hcaptcha.com', 'recaptcha.net', 'challenges.cloudflare.com',
]);
function isThirdParty(d) {
  if (d.resourceType === 'mainFrame' || !d.webContents) return false;
  let top;
  try { top = siteOf(d.webContents.getURL()); } catch { return false; }
  const req = siteOf(d.url);
  if (!top || !req || top === req) return false;
  if (SSO_SITES.has(req)) return false;
  return true;
}

// Сессия интерфейса — никакой сети вообще
function lockDefaultSession() {
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => {
    cb({ cancel: !/^(file|devtools):/i.test(d.url) });
  });
}

// ---------- Окно и вкладки ----------
let win, ui;
let tabs = [];
let activeId = null;
let nextId = 1;

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  ui.setBounds({ x: 0, y: 0, width: w, height: uiExpanded ? h : TOOLBAR_H });
  for (const t of tabs) t.view.setBounds({ x: 0, y: TOOLBAR_H, width: w, height: Math.max(0, h - TOOLBAR_H) });
}

// Вкладка считается живой, только пока её webContents не уничтожен
// (страница могла закрыть себя через window.close(), процесс мог упасть и т.п.)
function liveWc(t) {
  const wc = t && t.view && t.view.webContents;
  return wc && !wc.isDestroyed() ? wc : null;
}
function activeTab() {
  const t = tabs.find(x => x.id === activeId);
  return liveWc(t) ? t : undefined;
}
let quitting = false;
app.on('before-quit', () => { quitting = true; });

// Убрать вкладку, которую закрыла сама страница
function dropDeadTab(tab) {
  const i = tabs.indexOf(tab);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (quitting || !win || win.isDestroyed()) return;
  try { win.contentView.removeChildView(tab.view); } catch {}
  if (!tabs.length) return newTab();
  if (activeId === tab.id) activate(tabs[Math.min(i, tabs.length - 1)].id);
  else sendTabs();
}

function tabState() {
  return tabs.filter(t => liveWc(t)).map(t => {
    const wc = t.view.webContents;
    const nh = wc.navigationHistory;
    return {
      id: t.id,
      title: wc.getTitle() || 'Новая вкладка',
      url: t.errorUrl || wc.getURL(),
      loading: wc.isLoading(),
      active: t.id === activeId,
      bookmarked: bookmarks.some(b => b.url === wc.getURL()),
      translated: !!(t.tr && t.tr.active),
      canBack: nh ? nh.canGoBack() : wc.canGoBack(),
      canFwd: nh ? nh.canGoForward() : wc.canGoForward(),
    };
  });
}
// ---------- Закладки (локальный файл, сайтам недоступен) ----------
let bookmarks = [];
try { bookmarks = JSON.parse(fs.readFileSync(BM_PATH, 'utf8')).filter(b => b && /^https?:/i.test(b.url)); } catch {}
function saveBookmarks() {
  fs.writeFileSync(BM_PATH, JSON.stringify(bookmarks, null, 2), { mode: 0o600 });
  sendBookmarks();
  sendTabs();
}
function sendBookmarks() { if (ui && !ui.webContents.isDestroyed()) ui.webContents.send('bookmarks', bookmarks); }

// Пачка событий страницы (начало загрузки, заголовок, переход…) — одно обновление панели
let tabsTimer = null;
function sendTabs() {
  if (tabsTimer) return;
  tabsTimer = setTimeout(() => {
    tabsTimer = null;
    if (ui && !ui.webContents.isDestroyed()) ui.webContents.send('tabs', tabState());
  }, 16);
}
function toast(msg) { if (ui && !ui.webContents.isDestroyed()) ui.webContents.send('toast', msg); }

function errorPage(code, desc, url) {
  const proxyErr = /PROXY|TUNNEL|SOCKS/i.test(desc);
  const esc = (x) => String(x).replace(/[<>&"]/g, '');
  const html = `<!doctype html><meta charset="utf-8"><title>Ошибка</title>
<style>
body{margin:0;height:100vh;display:grid;place-items:center;color:#e9ecf5;font:15px "Segoe UI",system-ui,sans-serif;
background:radial-gradient(600px 300px at 30% 20%,rgba(139,92,246,.18),transparent 70%),
radial-gradient(600px 300px at 70% 80%,rgba(6,214,224,.12),transparent 70%),#07080d}
.c{max-width:560px;padding:32px 36px;border-radius:20px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
box-shadow:0 20px 60px rgba(0,0,0,.5)}
.o{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;font-size:26px;margin-bottom:14px;
background:${proxyErr ? 'rgba(251,113,133,.15)' : 'rgba(96,165,250,.15)'};box-shadow:0 0 30px ${proxyErr ? 'rgba(251,113,133,.35)' : 'rgba(96,165,250,.35)'}}
h2{margin:0 0 8px;font-weight:600;background:linear-gradient(90deg,#a78bfa,#60a5fa,#22d3ee);-webkit-background-clip:text;color:transparent}
p{margin:6px 0;line-height:1.5}.m{color:#8a90a6;font-size:13px}.u{color:#6b7086;font-size:12px;word-break:break-all}
</style><div class="c"><div class="o">${proxyErr ? '⛔' : '⚠'}</div>
<h2>${proxyErr ? 'Прокси недоступен' : 'Страница не загрузилась'}</h2>
<p>${proxyErr ? 'Соединение заблокировано: прямой выход в интернет отключён. Проверьте прокси в настройках.' : 'Попробуйте обновить страницу (Ctrl+R).'}</p>
<p class="m">${esc(desc)} (${esc(code)})</p><p class="u">${esc(url)}</p></div>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function newTab(url = START_URL) {
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      safeDialogs: true,
      preload: path.join(__dirname, 'tab-preload.js'),
    },
  });
  const id = nextId++;
  const tab = { id, view, errorUrl: null, tr: null };
  const wc = view.webContents;
  wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  setupEmulation(wc);
  wc.once('destroyed', () => dropDeadTab(tab));
  wc.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit') return;
    const u = wc.getURL();
    tab.errorUrl = u;
    wc.loadURL(errorPage(d.reason, 'Вкладка аварийно завершилась. Нажмите «Обновить» (Ctrl+R).', u)).catch(() => {});
  });

  wc.setWindowOpenHandler(openHandler);
  wc.on('did-create-window', setupPopup);
  wc.on('will-navigate', (e, u) => { if (!/^(https?|data|about):/i.test(e.url || u || '')) e.preventDefault(); });
  wc.on('did-start-navigation', (e, _u, inPage, isMainArg) => {
    const isMain = e.isMainFrame !== undefined ? e.isMainFrame : isMainArg;
    const sameDoc = e.isSameDocument !== undefined ? e.isSameDocument : inPage;
    if (isMain) tab.errorUrl = null;
    if (isMain && !sameDoc) tab.tr = null;
  });
  wc.on('did-fail-load', (_e, code, desc, u, isMain) => {
    if (!isMain || code === -3) return; // -3 = ABORTED
    if (/PROXY|TUNNEL|SOCKS/i.test(desc) && proxyStatus.state === 'ok') checkProxy();
    tab.errorUrl = u;
    wc.loadURL(errorPage(code, desc, u)).catch(() => {});
    setTimeout(() => { tab.errorUrl = u; sendTabs(); }, 50);
  });
  for (const ev of ['page-title-updated', 'did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) {
    wc.on(ev, sendTabs);
  }
  wc.on('before-input-event', (e, input) => handleShortcut(e, input));
  attachContextMenu(wc, tab);

  view.setVisible(false);
  win.contentView.addChildView(view);
  if (uiExpanded) win.contentView.addChildView(ui); // панель загрузок остаётся сверху
  tabs.push(tab);
  layout();
  activate(id);
  wc.loadURL(url).catch(() => {});
}

// Подмена часового пояса через DevTools-протокол: страница, iframe-ы
// из других процессов и воркеры видят TIMEZONE вместо системного.
// Подмены через DevTools-протокол для страницы, iframe-ов из других процессов и воркеров:
// часовой пояс, язык (navigator.language, Intl, Accept-Language) и Client Hints
// (navigator.userAgentData / Sec-CH-UA) как у обычного Google Chrome.
function uaMetadata() {
  const major = process.versions.chrome.split('.')[0];
  const full = process.versions.chrome;
  return {
    brands: [
      { brand: 'Google Chrome', version: major }, { brand: 'Chromium', version: major },
      { brand: 'Not_A Brand', version: '24' },
    ],
    fullVersionList: [
      { brand: 'Google Chrome', version: full }, { brand: 'Chromium', version: full },
      { brand: 'Not_A Brand', version: '24.0.0.0' },
    ],
    fullVersion: full, platform: 'Windows', platformVersion: '19.0.0',
    architecture: 'x86', model: '', mobile: false, bitness: '64', wow64: false,
  };
}
// Внутренние страницы браузера никуда не переходят и не открывают окна
function lockInternalPage(wc) {
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function setupEmulation(wc) {
  const dbg = wc.debugger;
  const send = (m, p, sid) => dbg.sendCommand(m, p || {}, sid).catch(() => {});
  const uaOverride = {
    userAgent: chromeLikeUA(ses.getUserAgent()),
    platform: 'Win32',
    userAgentMetadata: uaMetadata(),
  };
  if (ACCEPT_LANG) uaOverride.acceptLanguage = ACCEPT_LANG;
  const apply = (sid) => Promise.allSettled([
    TIMEZONE !== 'system' ? send('Emulation.setTimezoneOverride', { timezoneId: TIMEZONE }, sid) : null,
    LOCALE ? send('Emulation.setLocaleOverride', { locale: LOCALE }, sid) : null,
    send('Emulation.setUserAgentOverride', uaOverride, sid),
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sid),
  ]).then(() => { if (sid) send('Runtime.runIfWaitingForDebugger', {}, sid); });
  try { dbg.attach('1.3'); } catch { return; }
  dbg.on('message', (_e, method, params) => {
    if (method === 'Target.attachedToTarget' && params && params.sessionId) apply(params.sessionId);
  });
  apply(undefined);
}

// ---------- Перевод (запросы идут через прокси) ----------
let trExclude = new Set();
try { trExclude = new Set(JSON.parse(fs.readFileSync(TR_EXCL_PATH, 'utf8'))); } catch {}
function saveTrExclude() {
  try { fs.writeFileSync(TR_EXCL_PATH, JSON.stringify([...trExclude], null, 2)); } catch {}
}
const trCache = new Map();
function trCacheSet(k, v) {
  if (trCache.size > 20000) trCache.delete(trCache.keys().next().value);
  trCache.set(k, v);
}
async function gtranslate(text, tl) {
  const base = `${TR_URL}?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t`;
  const q = encodeURIComponent(text);
  const j = q.length < 6000
    ? await proxyJson(`${base}&q=${q}`)
    : await proxyJson(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'q=' + q,
    });
  return { text: (j[0] || []).map(x => (x && x[0]) || '').join(''), lang: j[2] || null };
}
function tabBySender(sender) { return tabs.find(t => t.view.webContents === sender); }

// ---------- Всплывающие окна (вход через Google и т.п.) ----------
// window.open с размерами — это окно входа: открываем его как настоящее окно,
// чтобы сайт получил ответ (window.opener / postMessage). Обычные ссылки
// target=_blank открываются новой вкладкой.
function openHandler({ url: u, disposition, features }) {
  if (!/^(https?:|about:blank)/i.test(u)) return { action: 'deny' };
  const isPopup = disposition === 'new-window' || /(width|height|popup)/i.test(features || '');
  if (isPopup) {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 520, height: 720, minWidth: 320, minHeight: 300,
        autoHideMenuBar: true, backgroundColor: '#ffffff', title: APP_NAME,
        icon: path.join(__dirname, 'ui', 'icon.png'),
        webPreferences: {
          session: ses, contextIsolation: true, sandbox: true, nodeIntegration: false,
          webSecurity: true, spellcheck: false, safeDialogs: true,
        },
      },
    };
  }
  if (/^https?:/i.test(u)) newTab(u);
  return { action: 'deny' };
}

// ---------- Инструменты разработчика и контекстное меню ----------
// Вкладки — это WebContentsView, в них DevTools нельзя «пристыковать»,
// поэтому открываем отдельным окном.
function toggleDevTools(wc) {
  if (!wc || wc.isDestroyed()) return;
  if (wc.isDevToolsOpened()) wc.closeDevTools();
  else wc.openDevTools({ mode: 'detach', activate: true });
}

function attachContextMenu(wc, tab) {
  wc.on('context-menu', (_e, p) => {
    const items = [];
    const httpLink = /^https?:/i.test(p.linkURL || '');
    if (httpLink) {
      items.push(
        { label: 'Открыть ссылку в новой вкладке', click: () => newTab(p.linkURL) },
        { label: 'Копировать адрес ссылки', click: () => clipboard.writeText(p.linkURL) },
        { type: 'separator' },
      );
    }
    if (p.mediaType === 'image' && /^https?:/i.test(p.srcURL || '')) {
      items.push(
        { label: 'Открыть изображение в новой вкладке', click: () => newTab(p.srcURL) },
        { label: 'Копировать адрес изображения', click: () => clipboard.writeText(p.srcURL) },
        { type: 'separator' },
      );
    }
    if (p.isEditable) {
      items.push(
        { label: 'Отменить', role: 'undo', enabled: p.editFlags.canUndo },
        { label: 'Повторить', role: 'redo', enabled: p.editFlags.canRedo },
        { type: 'separator' },
        { label: 'Вырезать', role: 'cut', enabled: p.editFlags.canCut },
        { label: 'Копировать', role: 'copy', enabled: p.editFlags.canCopy },
        { label: 'Вставить', role: 'paste', enabled: p.editFlags.canPaste },
        { label: 'Выделить всё', role: 'selectAll' },
        { type: 'separator' },
      );
    } else if (p.selectionText && p.selectionText.trim()) {
      const sel = p.selectionText.trim();
      const short = sel.length > 30 ? sel.slice(0, 30) + '…' : sel;
      items.push(
        { label: 'Копировать', role: 'copy' },
        { label: `Найти «${short}»`, click: () => newTab(SEARCH_URL + encodeURIComponent(sel.slice(0, 500))) },
        { type: 'separator' },
      );
    }
    const nh = wc.navigationHistory;
    items.push(
      { label: 'Назад', enabled: !!(nh && nh.canGoBack()), click: () => nh.goBack() },
      { label: 'Вперёд', enabled: !!(nh && nh.canGoForward()), click: () => nh.goForward() },
      { label: 'Обновить', click: () => wc.reload() },
    );
    if (tab) {
      items.push({
        label: tab.tr && tab.tr.active ? 'Показать оригинал' : 'Перевести страницу',
        click: () => { activate(tab.id); ipcMain.emit('tr:toggle'); },
      });
    }
    items.push(
      { type: 'separator' },
      {
        label: 'Просмотреть код',
        click: () => {
          if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach', activate: true });
          wc.inspectElement(p.x, p.y);
        },
      },
    );
    const owner = tab ? win : BrowserWindow.fromWebContents(wc);
    Menu.buildFromTemplate(items).popup(owner ? { window: owner } : {});
  });
}

function setupPopup(popup) {
  const pwc = popup.webContents;
  popup.setMenu(null);
  pwc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  setupEmulation(pwc);
  pwc.setWindowOpenHandler(openHandler);
  pwc.on('did-create-window', setupPopup);
  pwc.on('will-navigate', (e, u) => { if (!/^(https?|about):/i.test(e.url || u || '')) e.preventDefault(); });
  // В заголовке всегда виден реальный адрес — защита от поддельных окон входа
  const updateTitle = () => {
    if (popup.isDestroyed()) return;
    let host = '';
    try { host = new URL(pwc.getURL()).hostname; } catch {}
    popup.setTitle((host ? host + ' — ' : '') + (pwc.getTitle() || APP_NAME));
  };
  pwc.on('page-title-updated', (e) => { e.preventDefault(); updateTitle(); });
  pwc.on('did-navigate', updateTitle);
  pwc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = input.key.toLowerCase();
    if (k === 'f12' || (input.control && input.shift && (k === 'i' || k === 'j'))) { toggleDevTools(pwc); e.preventDefault(); }
  });
  attachContextMenu(pwc, null);
}

function activate(id) {
  activeId = id;
  for (const t of tabs) t.view.setVisible(t.id === id);
  const t = activeTab();
  if (t) t.view.webContents.focus();
  sendTabs();
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  try { win.contentView.removeChildView(t.view); } catch {}
  const wc = liveWc(t);
  if (wc) wc.close();
  if (!tabs.length) return newTab();
  if (activeId === id) activate(tabs[Math.min(i, tabs.length - 1)].id);
  else sendTabs();
}

function normalizeInput(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[^\s]+\.[^\s]{2,}$/.test(s) && !/\s/.test(s)) return 'https://' + s;
  return SEARCH_URL + encodeURIComponent(s);
}

function handleShortcut(e, input) {
  if (input.type !== 'keyDown') return;
  const mod = process.platform === 'darwin' ? input.meta : input.control;
  const k = input.key.toLowerCase();
  const t = activeTab();
  if (mod && k === 't') { newTab(); e.preventDefault(); }
  else if (mod && k === 'w') { if (t) closeTab(t.id); e.preventDefault(); }
  else if (mod && k === 'l') { ui.webContents.focus(); ui.webContents.send('focus-address'); e.preventDefault(); }
  else if ((mod && k === 'r') || k === 'f5') { t?.view.webContents.reload(); e.preventDefault(); }
  else if (input.alt && k === 'arrowleft') { t?.view.webContents.navigationHistory?.goBack(); e.preventDefault(); }
  else if (input.alt && k === 'arrowright') { t?.view.webContents.navigationHistory?.goForward(); e.preventDefault(); }
  else if (mod && k === 'd') { ipcMain.emit('bm:toggle'); e.preventDefault(); }
  else if (mod && input.shift && k === 'y') { ipcMain.emit('tr:toggle'); e.preventDefault(); }
  else if (k === 'f12' || (mod && input.shift && (k === 'i' || k === 'j'))) {
    toggleDevTools(t && liveWc(t)); e.preventDefault();
  }
}

// ---------- Состояние подключения к прокси ----------
// Прокси включён всегда (это единственный путь в сеть). Индикатор показывает,
// работает ли он: «Подключение…» → «Подключено» / «Нет подключения».
let proxyStatus = { state: 'connecting' };
let proxyTimer = null;
let ipInfo = null; // { ip, cc, country, tz } — запрашивается только при смене IP

function proxyErrorText(e) {
  const m = String((e && e.message) || e);
  if (/PROXY_AUTH|407/.test(m)) return 'Неверный логин или пароль прокси';
  if (/PROXY_CONNECTION_FAILED|CONNECTION_REFUSED/.test(m)) return 'Прокси не отвечает (проверьте адрес и порт)';
  if (/TUNNEL_CONNECTION_FAILED|SOCKS/.test(m)) return 'Прокси отказал в подключении';
  if (/NAME_NOT_RESOLVED/.test(m)) return 'Не удаётся найти адрес прокси';
  if (/INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE/.test(m)) return 'Нет интернета';
  if (/timeout|TIMED_OUT/.test(m)) return 'Прокси не ответил вовремя';
  return 'Ошибка: ' + m.replace(/^net::/, '');
}

function sendProxyStatus() {
  if (ui && !ui.webContents.isDestroyed()) ui.webContents.send('proxy', proxyStatus);
}

// Текущее смещение пояса от UTC, например «GMT+8»
function tzOffset(tz) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date());
    return (p.find(x => x.type === 'timeZoneName') || {}).value || null;
  } catch { return null; }
}

async function checkProxy() {
  clearTimeout(proxyTimer);
  if (!configured) return;
  if (proxyStatus.state !== 'ok') { proxyStatus = { state: 'connecting' }; sendProxyStatus(); }
  const t0 = Date.now();
  let next = 10_000;
  try {
    const j = await proxyJson(IP_CHECK_URL, { timeout: 12000 });
    const ms = Date.now() - t0;
    if (!ipInfo || ipInfo.ip !== j.ip) {
      ipInfo = { ip: j.ip };
      try {
        const w = await proxyJson(`${IP_INFO_URL}${encodeURIComponent(j.ip)}?fields=success,ip,country,country_code,timezone`, { timeout: 8000 });
        if (w && w.success !== false) {
          ipInfo = { ip: j.ip, cc: w.country_code || '', country: w.country || '', tz: (w.timezone && w.timezone.id) || '' };
        }
      } catch { /* страна необязательна */ }
      try {
        const rnd = require('crypto').randomBytes(16).toString('hex'); // 32 символа
        const d = await proxyJson(`http://${rnd}.${DNS_INFO_HOST}/json`, { timeout: 8000 });
        if (d && d.dns && d.dns.ip) {
          const [country, ...isp] = String(d.dns.geo || '').split(' - ');
          ipInfo.dns = { ip: d.dns.ip, country: (country || '').trim(), isp: isp.join(' - ').trim() };
        }
      } catch { /* DNS-проверка необязательна */ }
    }
    const norm = (x) => String(x || '').toLowerCase().replace(/^the\s+/, '').trim();
    const dns = ipInfo.dns || null;
    const browserOff = TIMEZONE !== 'system' ? tzOffset(TIMEZONE) : null;
    const proxyOff = ipInfo.tz ? tzOffset(ipInfo.tz) : null;
    proxyStatus = {
      state: 'ok', ip: ipInfo.ip, cc: ipInfo.cc || '', country: ipInfo.country || '', ms,
      proxy: `${cfg.type.toUpperCase()} ${cfg.host}:${cfg.port}`,
      // сравниваем смещение от UTC, а не название пояса (Мадрид и Берлин — одно и то же время)
      tzMismatch: !!(browserOff && proxyOff && browserOff !== proxyOff),
      proxyTz: ipInfo.tz || '', browserTz: TIMEZONE, proxyOff, browserOff,
      dnsIp: dns ? dns.ip : '', dnsCountry: dns ? dns.country : '', dnsIsp: dns ? dns.isp : '',
      dnsMismatch: !!(dns && dns.country && ipInfo.country && norm(dns.country) !== norm(ipInfo.country)),
    };
    next = 60_000;
  } catch (e) {
    proxyStatus = { state: 'fail', error: proxyErrorText(e), proxy: `${cfg.type.toUpperCase()} ${cfg.host}:${cfg.port}` };
  }
  sendProxyStatus();
  proxyTimer = setTimeout(checkProxy, next);
}

function createMainWindow() {
  win = new BaseWindow({
    width: 1280, height: 820, minWidth: 600, minHeight: 400,
    title: APP_NAME, backgroundColor: '#07080d', autoHideMenuBar: true,
    icon: path.join(__dirname, 'ui', 'icon.png'),
  });
  ui = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  ui.setBackgroundColor('#00000000');
  win.contentView.addChildView(ui);
  lockInternalPage(ui.webContents);
  ui.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
  ui.webContents.on('before-input-event', (e, input) => handleShortcut(e, input));
  ui.webContents.once('did-finish-load', () => {
    sendBookmarks();
    newTab();
    sendProxyStatus();
    checkProxy();
  });
  win.on('resize', layout);
  win.on('close', () => { quitting = true; });
  win.on('closed', () => app.quit());
  layout();
}

// ---------- Окно настроек ----------
let settingsWin = null;
function openSettings() {
  if (settingsWin) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    width: 500, height: 820, resizable: true, title: 'Настройки — S Browser',
    autoHideMenuBar: true, backgroundColor: '#07080d',
    icon: path.join(__dirname, 'ui', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  lockInternalPage(settingsWin.webContents);
  settingsWin.loadFile(path.join(__dirname, 'ui', 'settings.html'));
  settingsWin.on('closed', () => {
    settingsWin = null;
    if (!configured) app.quit();
  });
}

// ---------- IPC ----------
ipcOn('tab:new', () => newTab());
ipcOn('tab:close', (_e, id) => closeTab(id));
ipcOn('tab:switch', (_e, id) => activate(id));
ipcOn('nav:go', (_e, text) => {
  const url = normalizeInput(text);
  const t = activeTab();
  if (url && t) t.view.webContents.loadURL(url).catch(() => {});
});
ipcOn('nav:back', () => activeTab()?.view.webContents.navigationHistory?.goBack());
ipcOn('nav:fwd', () => activeTab()?.view.webContents.navigationHistory?.goForward());
ipcOn('nav:reload', () => activeTab()?.view.webContents.reload());
ipcOn('nav:stop', () => activeTab()?.view.webContents.stop());
ipcOn('ip:check', () => { ipInfo = null; proxyStatus = { state: 'connecting' }; sendProxyStatus(); checkProxy(); });
ipcOn('settings:open', () => openSettings());
ipcOn('downloads:open', () => { fs.mkdirSync(DL_DIR, { recursive: true }); shell.openPath(DL_DIR); });

ipcOn('bm:toggle', () => {
  const t = activeTab();
  if (!t) return;
  const wc = t.view.webContents;
  const url = wc.getURL();
  if (!/^https?:/i.test(url)) return;
  const i = bookmarks.findIndex(b => b.url === url);
  if (i >= 0) bookmarks.splice(i, 1);
  else bookmarks.push({ url, title: (wc.getTitle() || new URL(url).hostname).slice(0, 60) });
  saveBookmarks();
});
ipcOn('bm:open', (_e, { index, inNewTab }) => {
  const b = bookmarks[index];
  if (!b || !/^https?:/i.test(b.url)) return;
  const t = activeTab();
  if (inNewTab || !t) newTab(b.url);
  else t.view.webContents.loadURL(b.url).catch(() => {});
});
ipcOn('bm:rename', (_e, { index, title }) => {
  if (!bookmarks[index]) return;
  const s = String(title || '').trim().slice(0, 60);
  if (s) bookmarks[index].title = s;
  saveBookmarks();
});
ipcOn('bm:menu', (_e, index) => {
  const b = bookmarks[index];
  if (!b) return;
  const move = (d) => {
    const j = index + d;
    if (j < 0 || j >= bookmarks.length) return;
    [bookmarks[index], bookmarks[j]] = [bookmarks[j], bookmarks[index]];
    saveBookmarks();
  };
  Menu.buildFromTemplate([
    { label: 'Открыть в новой вкладке', click: () => newTab(b.url) },
    { label: 'Переименовать', click: () => ui.webContents.send('bm:rename-start', index) },
    { type: 'separator' },
    { label: '← Переместить влево', enabled: index > 0, click: () => move(-1) },
    { label: 'Переместить вправо →', enabled: index < bookmarks.length - 1, click: () => move(1) },
    { type: 'separator' },
    { label: 'Удалить', click: () => { bookmarks.splice(index, 1); saveBookmarks(); } },
  ]).popup({ window: win });
});

// ---------- Перевод: IPC ----------
ipcHandle('tr:config', (e, host) => {
  if (!tabBySender(e.sender)) return null;
  return { auto: TR_AUTO, target: TR_LANG, excluded: trExclude.has(String(host || '')) };
});
ipcHandle('tr:translate', async (e, texts, target) => {
  if (!tabBySender(e.sender) || !ses) return { ok: false };
  if (!Array.isArray(texts) || texts.length > 100) return { ok: false };
  const tl = TR_LANGS.includes(target) ? target : TR_LANG;
  const items = texts.map(s => String(s).replace(/\s+/g, ' ').trim().slice(0, 2000));
  const out = new Array(items.length).fill('');
  const need = [];
  items.forEach((s, i) => {
    const c = trCache.get(tl + '\u0000' + s);
    if (c !== undefined) out[i] = c; else if (s) need.push(i);
  });
  let lang = null;
  // Названия, адреса, IP и т.п. — под метки; то, что целиком из них состоит, не переводим
  const prot = new Map();
  const send = [];
  for (const i of need) {
    const p = protect(items[i]);
    if (p.nothingToTranslate) { out[i] = items[i]; trCacheSet(tl + '\u0000' + items[i], out[i]); continue; }
    prot.set(i, p);
    send.push(i);
  }
  if (send.length) {
    try {
      const r = await gtranslate(send.map(i => prot.get(i).text).join('\n'), tl);
      lang = r.lang;
      let parts = r.text.split('\n');
      if (parts.length !== send.length) {
        // Google склеил/разбил строки — переводим по одной
        parts = [];
        for (const i of send) parts.push((await gtranslate(prot.get(i).text, tl)).text);
      }
      for (let k = 0; k < send.length; k++) {
        const i = send[k];
        let t = restore((parts[k] || '').trim(), prot.get(i).tokens);
        if (t === null) t = (await gtranslate(items[i], tl)).text.trim(); // метка потерялась — без защиты
        out[i] = t;
        trCacheSet(tl + '\u0000' + items[i], out[i]);
      }
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, out, lang };
});
ipcOn('tr:state', (e, st) => {
  const t = tabBySender(e.sender);
  if (!t) return;
  t.tr = { active: !!(st && st.active), lang: st && typeof st.lang === 'string' ? st.lang : null };
  sendTabs();
});
ipcOn('tr:toggle', () => {
  const t = activeTab();
  if (!t) return;
  const wc = t.view.webContents;
  let host = '';
  try { host = new URL(wc.getURL()).hostname; } catch {}
  if (!host) return;
  const on = !(t.tr && t.tr.active);
  // Выключили перевод на сайте — больше не переводим его автоматически, и наоборот
  if (on) trExclude.delete(host); else if (TR_AUTO) trExclude.add(host);
  saveTrExclude();
  wc.send('tr:set', on);
});

// ---------- Автообновление ----------
let updateReady = null;
function setupUpdater() {
  if (!autoUpdater || !app.isPackaged || !configured) return;
  // Проверка обновлений тоже идёт только через прокси
  session.fromPartition('electron-updater', { cache: false })
    .setProxy({ proxyRules: proxyUrl, proxyBypassRules: '<-loopback>' }).catch(() => {});
  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = info.version;
    if (ui && !ui.webContents.isDestroyed()) ui.webContents.send('update', { version: info.version });
  });
  autoUpdater.on('error', () => {});
  // Пароль прокси для запросов обновлений
  autoUpdater.on('login', (authInfo, callback) => {
    if (authInfo && authInfo.isProxy && cfg.user) callback(cfg.user, decryptPass(cfg.pass));
    else callback();
  });
  const check = () => { autoUpdater.checkForUpdates().catch(() => {}); };
  setTimeout(check, 15_000);
  setInterval(check, 3 * 60 * 60 * 1000);
}
ipcOn('update:install', () => {
  if (updateReady && autoUpdater) autoUpdater.quitAndInstall(true, true);
});

ipcHandle('settings:get', () => {
  const c = cfg || {};
  return {
    type: c.type || 'socks5', host: c.host || '', port: c.port || '',
    user: c.user || '', hasPass: !!c.pass, incognito: !!c.incognito,
    noCache: c.noCache !== false, block3p: c.block3p !== false,
    timezone: TIMEZONE, autoTranslate: TR_AUTO, translateTo: TR_LANG,
    browserLang: LANG_MODE, tzLocales: TZ_LOCALE,
    version: app.getVersion(),
    configured,
  };
});

ipcHandle('settings:save', (_e, data) => {
  const type = PROXY_TYPES.includes(data.type) ? data.type : 'http';
  const host = String(data.host || '').trim();
  const port = parseInt(data.port, 10);
  if (!host || /[\s/]/.test(host)) return { ok: false, error: 'Некорректный адрес прокси' };
  if (!(port > 0 && port < 65536)) return { ok: false, error: 'Некорректный порт' };
  const user = String(data.user || '').trim();
  if (user && type.startsWith('socks')) {
    return { ok: false, error: 'Chromium не поддерживает SOCKS с логином/паролем. Используйте HTTP/HTTPS-прокси с авторизацией или SOCKS5 без пароля (по IP).' };
  }
  const next = {
    type, host, port, user, incognito: !!data.incognito,
    noCache: data.noCache !== false, block3p: data.block3p !== false,
    timezone: (data.timezone === 'system' || TZ_RE.test(data.timezone || '')) ? data.timezone : TZ_DEFAULT,
    tzV2: true,
    browserLang: (data.browserLang === 'system' || LOCALE_RE.test(data.browserLang || '')) ? data.browserLang : 'auto',
    autoTranslate: data.autoTranslate !== false,
    translateTo: TR_LANGS.includes(data.translateTo) ? data.translateTo : 'ru',
  };
  if (data.pass) next.pass = encryptPass(data.pass);
  else if (cfg && cfg.pass && user) next.pass = cfg.pass;
  fs.writeFileSync(CFG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  app.relaunch();
  app.exit(0);
  return { ok: true };
});

ipcHandle('data:clear', async () => {
  if (!ses) return { ok: false };
  await ses.clearStorageData();
  await ses.clearCache();
  await ses.clearAuthCache();
  return { ok: true };
});

// ---------- Старт ----------
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  lockDefaultSession();
  if (!configured) return openSettings();
  await setupSession();
  createMainWindow();
  setupUpdater();
  if (SMOKE) {
    setTimeout(async () => {
      let page = null, uiOk = false;
      try {
        const t = activeTab();
        page = await t.view.webContents.executeJavaScript(`({
          language: navigator.language, languages: navigator.languages,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          intlLocale: Intl.DateTimeFormat().resolvedOptions().locale,
          secure: window.isSecureContext,
          brands: navigator.userAgentData ? navigator.userAgentData.brands.map(b => b.brand) : null,
          ua: navigator.userAgent })`);
      } catch (e) { smokeErrors.push('page probe: ' + e); }
      let uiProbe = null;
      try {
        uiProbe = await ui.webContents.executeJavaScript(`({
          url: location.href, title: document.title,
          addr: !!document.getElementById('addr'), panel: !!document.getElementById('dlpanel'),
          icons: typeof icon === 'function' && !!document.querySelector('#back svg'),
          css: getComputedStyle(document.getElementById('top')).height })`);
        uiOk = !!(uiProbe.addr && uiProbe.panel && uiProbe.icons && uiProbe.css === '112px');
      } catch (e) { smokeErrors.push('ui probe: ' + e); }
      const expectLang = LOCALE || null;
      const pageOk = !!page && (!expectLang || page.language === expectLang)
        && (TIMEZONE === 'system' || page.tz === TIMEZONE)
        && Array.isArray(page.languages) && !page.languages.some(l => l.includes(';'))
        && (!page.secure || !!(page.brands && page.brands.includes('Google Chrome')))
        && !/Electron|SBrowser/i.test(page.ua);
      const res = {
        page, uiOk, uiProbe, pageOk, expectLang,
        ok: smokeErrors.length === 0 && !!win && tabs.length > 0 && uiOk && pageOk
          && !/Electron|SBrowser|S Browser|s-browser/i.test(ses.getUserAgent()),
        tabs: tabs.length,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        userAgent: ses.getUserAgent(),
        timezone: TIMEZONE,
        errors: smokeErrors,
      };
      try { fs.writeFileSync(path.join(DATA_DIR, 'smoke.json'), JSON.stringify(res, null, 2)); } catch {}
      app.exit(res.ok ? 0 : 1);
    }, 12000);
  }
});

app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', e => e.preventDefault()); // никаких <webview>
});

app.on('second-instance', () => { if (win) win.focus(); });
app.on('window-all-closed', () => app.quit());

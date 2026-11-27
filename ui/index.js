'use strict';
const $ = id => document.getElementById(id);
const tabsEl = $('tabs'), addr = $('addr'), ipEl = $('ip'), omni = $('omni');
let state = [];
let loading = false;

const COLORS = ['#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1'];
function colorFor(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
function letterBadge(host, cls) {
  const s = document.createElement('span');
  s.className = cls;
  const c = colorFor(host || '?');
  s.style.background = `linear-gradient(135deg, ${c}, ${c}aa)`;
  s.textContent = (host[0] || '•').toUpperCase();
  return s;
}

// ---------- Вкладки и адресная строка ----------
// Вкладки обновляются на месте (по id), а не пересоздаются: без лишней перерисовки и анимации
const tabEls = new Map();
function makeTab(id) {
  const el = document.createElement('div');
  el.className = 'tab';
  const lead = document.createElement('span'); lead.className = 'lead';
  const title = document.createElement('span'); title.className = 't';
  const x = document.createElement('span'); x.className = 'x'; x.title = 'Закрыть (Ctrl+W)';
  x.innerHTML = icon('close');
  // Закрываем по нажатию: при переключении вкладок панель обновляется,
  // и обычный click до крестика не доходил
  x.onmousedown = e => {
    e.stopPropagation(); e.preventDefault();
    if (e.button === 0 || e.button === 1) api.send('tab:close', id);
  };
  el.onmousedown = e => {
    if (e.button === 1) { e.preventDefault(); api.send('tab:close', id); }
    else if (e.button === 0 && !el.classList.contains('active')) api.send('tab:switch', id);
  };
  const dot = document.createElement('span'); dot.className = 'tr-dot'; dot.title = 'Переведено';
  el.append(lead, title, x, dot);
  return el;
}
function render() {
  const ids = new Set(state.map(t => t.id));
  for (const [id, el] of tabEls) if (!ids.has(id)) { el.remove(); tabEls.delete(id); }
  state.forEach((t, i) => {
    let el = tabEls.get(t.id);
    if (!el) { el = makeTab(t.id); tabEls.set(t.id, el); }
    if (tabsEl.children[i] !== el) tabsEl.insertBefore(el, tabsEl.children[i] || null);
    el.classList.toggle('active', !!t.active);
    const tip = t.title + '\n' + t.url;
    if (el.title !== tip) el.title = tip;
    const tt = el.querySelector('.t');
    if (tt.textContent !== t.title) tt.textContent = t.title;
    const host = hostOf(t.url);
    const leadKey = t.loading ? 'spin' : 'fav:' + host;
    const lead = el.querySelector('.lead');
    if (lead.dataset.k !== leadKey) {
      lead.dataset.k = leadKey;
      lead.replaceChildren(t.loading ? Object.assign(document.createElement('span'), { className: 'spin' }) : letterBadge(host, 'fav'));
    }
    el.querySelector('.tr-dot').style.display = t.translated ? '' : 'none';
  });
  const a = state.find(t => t.active);
  if (!a) return;
  const isData = a.url.startsWith('data:');
  if (document.activeElement !== addr) addr.value = isData ? '' : prettyUrl(a.url);
  $('back').disabled = !a.canBack;
  $('fwd').disabled = !a.canFwd;
  loading = a.loading;
  setIcon($('reload'), loading ? 'stop' : 'reload');
  $('reload').title = loading ? 'Остановить загрузку' : 'Обновить (Ctrl+R)';
  $('loadbar').classList.toggle('on', !!loading);

  const tr = $('tr');
  tr.classList.toggle('on', !!a.translated);
  tr.title = a.translated ? 'Показать оригинал (Ctrl+Shift+Y)' : 'Перевести страницу (Ctrl+Shift+Y)';
  const star = $('star');
  star.classList.toggle('on', !!a.bookmarked);
  star.title = a.bookmarked ? 'Убрать из закладок (Ctrl+D)' : 'Добавить в закладки (Ctrl+D)';

  const sec = $('sec');
  if (/^https:/i.test(a.url)) { setIcon(sec, 'lock'); sec.className = ''; sec.title = 'Защищённое соединение (HTTPS)'; }
  else if (/^http:/i.test(a.url)) { setIcon(sec, 'unlock'); sec.className = 'http'; sec.title = 'Соединение не защищено (HTTP)'; }
  else { setIcon(sec, 'search'); sec.className = 'info'; sec.title = ''; }
}
// Адрес без лишнего: https:// и завершающий слеш скрываем, пока строка не в фокусе
function prettyUrl(u) {
  try {
    const x = new URL(u);
    if (x.protocol === 'https:') return (x.host + x.pathname + x.search + x.hash).replace(/\/$/, '');
  } catch {}
  return u;
}
api.on('tabs', s => { state = s; render(); });

addr.addEventListener('focus', () => {
  omni.classList.add('focus');
  const a = state.find(t => t.active);
  if (a && !a.url.startsWith('data:')) addr.value = a.url;
  setTimeout(() => addr.select(), 0);
});
addr.addEventListener('blur', () => { omni.classList.remove('focus'); render(); });
addr.addEventListener('keydown', e => {
  if (e.key === 'Enter') { api.send('nav:go', addr.value); addr.blur(); }
  if (e.key === 'Escape') { addr.blur(); }
});
api.on('focus-address', () => { addr.focus(); addr.select(); });

// ---------- Статус прокси ----------
const ipText = $('iptext');
api.on('proxy', st => {
  if (st.state === 'ok') {
    const warn = st.tzMismatch || st.dnsMismatch;
    ipEl.className = warn ? 'warn' : 'ok';
    ipText.innerHTML = '';
    const a = document.createElement('span'); a.textContent = (st.cc ? st.cc + ' · ' : '') + st.ip;
    const b = document.createElement('span'); b.className = 'muted'; b.textContent = ' · ' + st.ms + ' мс';
    ipText.append(a, b);
    if (warn) { const w = document.createElement('span'); w.textContent = ' · ⚠'; ipText.append(w); }
    const lines = ['Прокси подключён', 'Прокси: ' + st.proxy,
      'Внешний IP: ' + st.ip + (st.country ? ' (' + st.country + ')' : ''),
      'Задержка: ' + st.ms + ' мс'];
    if (st.dnsIp) lines.push('DNS прокси: ' + st.dnsIp + (st.dnsCountry ? ' (' + st.dnsCountry + (st.dnsIsp ? ', ' + st.dnsIsp : '') + ')' : ''));
    const notes = [];
    if (st.dnsMismatch) notes.push('⚠ DNS-сервер прокси находится в другой стране (' + st.dnsCountry + '), чем его IP (' + st.country +
      '). Это не утечка ваших данных, но сайты могут заметить несовпадение. Его настраивает владелец прокси.');
    if (st.tzMismatch) notes.push('⚠ Часовой пояс браузера (' + st.browserTz + ', ' + st.browserOff + ') не совпадает с поясом прокси (' +
      st.proxyTz + ', ' + st.proxyOff + '). Его можно поменять в настройках.');
    ipEl.title = lines.join('\n') + (notes.length ? '\n\n' + notes.join('\n\n') : '') + '\n\nНажмите, чтобы проверить ещё раз';
  } else if (st.state === 'fail') {
    ipEl.className = 'bad';
    ipText.textContent = 'Нет связи с прокси';
    ipEl.title = (st.proxy ? 'Прокси: ' + st.proxy + '\n' : '') + (st.error || '') +
      '\n\nПовторная попытка каждые 10 секунд. Нажмите, чтобы проверить сейчас.';
  } else {
    ipEl.className = 'wait';
    ipText.textContent = 'Подключение…';
    ipEl.title = 'Подключение к прокси…';
  }
});
ipEl.onclick = () => api.send('ip:check');

let toastTimer;
api.on('toast', msg => {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
});

// ---------- Закладки ----------
const bmEl = $('bm'), bmHint = $('bmhint');
let bookmarks = [];
function renderBookmarks() {
  bmEl.querySelectorAll('.bm').forEach(n => n.remove());
  bmHint.style.display = bookmarks.length ? 'none' : '';
  bookmarks.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'bm';
    el.title = b.title + '\n' + b.url;
    const host = hostOf(b.url);
    const n = document.createElement('span'); n.className = 'n'; n.textContent = b.title || host;
    el.append(letterBadge(host, 'ic'), n);
    el.dataset.i = i;
    el.onmouseup = e => {
      if (e.button === 0) api.send('bm:open', { index: i, inNewTab: e.ctrlKey || e.metaKey });
      else if (e.button === 1) api.send('bm:open', { index: i, inNewTab: true });
    };
    el.oncontextmenu = e => { e.preventDefault(); api.send('bm:menu', i); };
    bmEl.appendChild(el);
  });
}
api.on('bookmarks', list => { bookmarks = list; renderBookmarks(); });
api.on('bm:rename-start', i => {
  const el = bmEl.querySelector(`.bm[data-i="${i}"]`);
  if (!el) return;
  const n = el.querySelector('.n');
  const input = document.createElement('input');
  input.value = bookmarks[i].title;
  n.replaceWith(input);
  el.onmouseup = null;
  input.focus(); input.select();
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    if (ok) api.send('bm:rename', { index: i, title: input.value });
    else renderBookmarks();
  };
  input.onkeydown = e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
  input.onblur = () => finish(true);
});

// ---------- Кнопки ----------
$('star').onclick = () => api.send('bm:toggle');
$('tr').onclick = () => api.send('tr:toggle');
$('newtab').onclick = () => api.send('tab:new');
$('back').onclick = () => api.send('nav:back');
$('fwd').onclick = () => api.send('nav:fwd');
$('reload').onclick = () => api.send(loading ? 'nav:stop' : 'nav:reload');
$('settings').onclick = () => api.send('settings:open');
api.on('update', u => {
  const b = $('upd');
  b.innerHTML = icon('up');
  b.append(document.createTextNode('Обновить до ' + u.version));
  b.style.display = '';
});
$('upd').onclick = () => api.send('update:install');

// ---------- Загрузки ----------
const dlBtn = $('dl'), dlList = $('dllist'), dlEmpty = $('dlempty'), dlSum = $('dlsum');
const ring = dlBtn.querySelector('.ring');
const RING_LEN = 94.25;
const ORB_R = 20, ORB_LEN = 2 * Math.PI * ORB_R;
let dls = [];
let panelOpen = false;
let doneTimer = null;

const TYPE_COLORS = [
  [/^(exe|msi|dmg|apk|appimage|deb|rpm)$/, '#8b5cf6'],
  [/^(zip|rar|7z|tar|gz|xz|bz2|iso)$/, '#f59e0b'],
  [/^(pdf)$/, '#ef4444'],
  [/^(png|jpe?g|gif|webp|svg|bmp|heic|avif|ico)$/, '#06b6d4'],
  [/^(mp4|mkv|mov|avi|webm|m4v)$/, '#ec4899'],
  [/^(mp3|wav|flac|ogg|m4a|aac)$/, '#10b981'],
  [/^(docx?|xlsx?|pptx?|odt|ods|csv|txt|rtf|md)$/, '#3b82f6'],
];
function typeOf(name) {
  const ext = ((name.match(/\.([a-z0-9]{1,8})$/i) || [])[1] || '').toLowerCase();
  const c = (TYPE_COLORS.find(([re]) => re.test(ext)) || [null, '#6366f1'])[1];
  return { ext: ext.slice(0, 4) || 'file', color: c };
}
function fmtBytes(n) {
  if (!n || n < 0) return '0 Б';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
}
function fmtTime(sec) {
  if (!isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return Math.ceil(sec) + ' с';
  if (sec < 3600) return Math.floor(sec / 60) + ' мин ' + Math.round(sec % 60) + ' с';
  return Math.floor(sec / 3600) + ' ч ' + Math.round((sec % 3600) / 60) + ' мин';
}
function actBtn(name, title, ch, id, cls) {
  const b = document.createElement('button');
  b.className = 'ib ' + (cls || '');
  b.title = title;
  b.innerHTML = icon(name);
  b.onclick = (e) => { e.stopPropagation(); api.send(ch, id); };
  return b;
}
// ---- Строка загрузки: создаётся один раз, дальше меняются только значения ----
// (раньше список пересоздавался 4 раза в секунду: строки «дёргались», а нажатие
// на «Пауза» могло потеряться, потому что кнопку успевали заменить)
const dlEls = new Map();
const NS = 'http://www.w3.org/2000/svg';

function makeDlRow(d) {
  const t = typeOf(d.name);
  const el = document.createElement('div');
  el.className = 'di';
  const orbEl = document.createElement('div'); orbEl.className = 'orb';
  orbEl.style.setProperty('--c', t.color);
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'ring'); svg.setAttribute('viewBox', '0 0 44 44');
  const mk = (cls) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', cls); c.setAttribute('cx', '22'); c.setAttribute('cy', '22'); c.setAttribute('r', String(ORB_R));
    c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '2.5');
    return c;
  };
  const trk = mk('trk'), val = mk('val');
  val.setAttribute('stroke-linecap', 'round'); val.setAttribute('stroke-dasharray', String(ORB_LEN));
  val.setAttribute('stroke-dashoffset', String(ORB_LEN));
  svg.append(trk, val);
  const core = document.createElement('div'); core.className = 'core';
  orbEl.append(svg, core);
  const body = document.createElement('div'); body.className = 'body';
  const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = d.name; nm.title = d.name;
  const bar = document.createElement('div'); bar.className = 'bar';
  const fill = document.createElement('i'); bar.appendChild(fill);
  const meta = document.createElement('div'); meta.className = 'meta';
  body.append(nm, bar, meta);
  const acts = document.createElement('div'); acts.className = 'acts';
  el.append(orbEl, body, acts);
  el.ondblclick = () => { if (el.dataset.state === 'completed') api.send('dl:open', d.id); };
  return { el, t, val, core, bar, fill, meta, acts, key: {} };
}

function updateDlRow(r, d) {
  const failed = d.state === 'interrupted' || d.state === 'cancelled';
  const cls = 'di ' + (failed ? 'failed' : d.state) + (d.paused ? ' paused' : '') +
    (d.state === 'progressing' && !d.total ? ' indet' : '');
  if (r.el.className !== cls) r.el.className = cls;
  r.el.dataset.state = d.state;
  r.el.title = d.state === 'completed' ? 'Двойной клик — открыть' : '';

  // кольцо
  const frac = d.state === 'completed' ? 1 : d.total ? d.received / d.total : 0.25;
  const stroke = d.state === 'completed' ? 'var(--ok)' : failed ? 'var(--bad)' : d.paused ? '#fbbf24' : r.t.color;
  r.val.setAttribute('stroke', stroke);
  r.val.setAttribute('stroke-dashoffset', String(ORB_LEN * (1 - frac)));

  // значок в центре — только при смене состояния
  const coreKey = d.state === 'completed' ? 'ok' : failed ? 'bad' : 'ext';
  if (r.key.core !== coreKey) {
    r.key.core = coreKey;
    if (coreKey === 'ok') { r.core.innerHTML = icon('check'); r.core.style.background = `radial-gradient(circle at 30% 25%, ${r.t.color}, ${r.t.color}66)`; }
    else if (coreKey === 'bad') { r.core.innerHTML = icon('alert'); r.core.style.background = 'rgba(251,113,133,.25)'; }
    else { r.core.textContent = r.t.ext; r.core.style.background = `radial-gradient(circle at 30% 25%, ${r.t.color}, ${r.t.color}66)`; }
  }

  // полоса
  r.bar.style.display = d.state === 'progressing' ? '' : 'none';
  if (d.state === 'progressing') r.fill.style.width = d.total ? Math.max(2, d.received / d.total * 100).toFixed(1) + '%' : '35%';

  // подпись
  let text, speedText = '', tail = '';
  if (d.state === 'progressing') {
    text = (d.total ? Math.floor(d.received / d.total * 100) + '% · ' : '') + fmtBytes(d.received) + (d.total ? ' из ' + fmtBytes(d.total) : '');
    if (d.paused) text += ' · пауза';
    else if (d.speed > 0) {
      speedText = ' · ' + fmtBytes(d.speed) + '/с';
      if (d.total) { const left = fmtTime((d.total - d.received) / d.speed); if (left) tail = ' · ' + left; }
    }
  } else if (d.state === 'completed') text = 'Готово · ' + fmtBytes(d.received);
  else text = d.state === 'cancelled' ? 'Отменено' : 'Ошибка загрузки';
  const metaKey = text + '|' + speedText + '|' + tail;
  if (r.key.meta !== metaKey) {
    r.key.meta = metaKey;
    r.meta.textContent = text;
    if (speedText) { const sp = document.createElement('span'); sp.className = 'sp'; sp.textContent = speedText; r.meta.appendChild(sp); }
    if (tail) r.meta.append(tail);
  }

  // кнопки — пересоздаём только при смене состояния/паузы
  const actKey = d.state + (d.paused ? ':p' : '');
  if (r.key.acts !== actKey) {
    r.key.acts = actKey;
    r.acts.textContent = '';
    if (d.state === 'progressing') {
      r.acts.append(
        actBtn(d.paused ? 'play' : 'pause', d.paused ? 'Продолжить' : 'Пауза', 'dl:pause', d.id),
        actBtn('close', 'Отменить', 'dl:cancel', d.id, 'danger'),
      );
    } else if (d.state === 'completed') {
      r.acts.append(actBtn('open', 'Открыть файл', 'dl:open', d.id), actBtn('folder', 'Показать в папке', 'dl:show', d.id));
    }
  }
}

function renderDownloads() {
  const active = dls.filter(d => d.state === 'progressing');
  const known = active.filter(d => d.total > 0);
  const total = known.reduce((a, d) => a + d.total, 0);
  const got = known.reduce((a, d) => a + d.received, 0);
  const speed = active.reduce((a, d) => a + (d.paused ? 0 : d.speed), 0);

  // кнопка в панели
  dlBtn.classList.toggle('multi', active.length > 1);
  dlBtn.querySelector('.badge').textContent = active.length;
  if (active.length) {
    clearTimeout(doneTimer);
    dlBtn.classList.remove('done');
    dlBtn.classList.add('busy');
    ring.setAttribute('stroke-dashoffset', String(RING_LEN * (1 - (total ? got / total : 0.12))));
    dlBtn.title = 'Загрузки: ' + active.length + (total ? ' · ' + Math.floor(got / total * 100) + '%' : '');
  } else {
    dlBtn.title = 'Загрузки';
    if (dlBtn.classList.contains('busy')) {
      dlBtn.classList.remove('busy');
      dlBtn.classList.add('done');
      ring.setAttribute('stroke-dashoffset', '0');
      clearTimeout(doneTimer);
      doneTimer = setTimeout(() => dlBtn.classList.remove('done'), 2600);
    }
  }

  // сводка
  let sum;
  if (active.length) {
    sum = `${active.length} ${active.length === 1 ? 'файл' : 'файла'} · ` +
      (speed > 0 ? fmtBytes(speed) + '/с' : 'ожидание') +
      (total && speed > 0 ? ' · осталось ' + fmtTime((total - got) / speed) : '');
  } else {
    const done = dls.filter(d => d.state === 'completed').length;
    sum = dls.length ? `Готово: ${done} из ${dls.length}` : '';
  }
  if (dlSum.textContent !== sum) dlSum.textContent = sum;

  // список рисуем, только когда панель открыта
  if (!panelOpen) return;
  dlEmpty.style.display = dls.length ? 'none' : '';
  const ids = new Set(dls.map(d => d.id));
  for (const [id, r] of dlEls) if (!ids.has(id)) { r.el.remove(); dlEls.delete(id); }
  dls.forEach((d, i) => {
    let r = dlEls.get(d.id);
    if (!r) { r = makeDlRow(d); dlEls.set(d.id, r); }
    updateDlRow(r, d);
    if (dlList.children[i] !== r.el) dlList.insertBefore(r.el, dlList.children[i] || null);
  });
}
api.on('downloads', list => { dls = list; renderDownloads(); });

function setPanel(open) {
  const wasOpen = panelOpen;
  panelOpen = open;
  if (open && !wasOpen) renderDownloads();
  document.body.classList.toggle('dl-open', open);
  dlBtn.classList.toggle('active', open);
}
api.on('dl:panel', open => setPanel(open));
dlBtn.onclick = () => api.send('dl:panel', !panelOpen);
$('overlay').onmousedown = () => api.send('dl:panel', false);
$('dlfolder').onclick = () => api.send('downloads:open');
$('dlclear').onclick = () => api.send('dl:clear');
document.addEventListener('keydown', e => { if (e.key === 'Escape' && panelOpen) api.send('dl:panel', false); });
renderDownloads();

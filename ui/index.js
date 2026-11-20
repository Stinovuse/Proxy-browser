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
    ipEl.className = st.tzMismatch ? 'warn' : 'ok';
    ipText.innerHTML = '';
    const a = document.createElement('span'); a.textContent = (st.cc ? st.cc + ' · ' : '') + st.ip;
    const b = document.createElement('span'); b.className = 'muted'; b.textContent = ' · ' + st.ms + ' мс';
    ipText.append(a, b);
    ipEl.title = 'Прокси подключён\nПрокси: ' + st.proxy + '\nВнешний IP: ' + st.ip +
      (st.country ? ' (' + st.country + ')' : '') + '\nЗадержка: ' + st.ms + ' мс' +
      (st.tzMismatch ? '\n\n⚠ Часовой пояс браузера (' + st.browserTz + ') не совпадает с поясом прокси (' +
        st.proxyTz + '). Его можно поменять в настройках.' : '') + '\n\nНажмите, чтобы проверить ещё раз';
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
function orb(d, t) {
  const o = document.createElement('div');
  o.className = 'orb';
  o.style.setProperty('--c', t.color);
  const frac = d.state === 'completed' ? 1 : d.total ? d.received / d.total : 0.25;
  const stroke = d.state === 'completed' ? 'var(--ok)' : (d.state === 'interrupted' || d.state === 'cancelled') ? 'var(--bad)'
    : d.paused ? '#fbbf24' : t.color;
  o.innerHTML = `<svg class="ring" viewBox="0 0 44 44"><circle class="trk" cx="22" cy="22" r="${ORB_R}" fill="none" stroke-width="2.5"/>` +
    `<circle class="val" cx="22" cy="22" r="${ORB_R}" fill="none" stroke-width="2.5" stroke-linecap="round" stroke="${stroke}" ` +
    `stroke-dasharray="${ORB_LEN}" stroke-dashoffset="${ORB_LEN * (1 - frac)}"/></svg>`;
  const core = document.createElement('div');
  core.className = 'core';
  core.style.background = `radial-gradient(circle at 30% 25%, ${t.color}, ${t.color}66)`;
  if (d.state === 'completed') core.innerHTML = icon('check');
  else if (d.state === 'interrupted' || d.state === 'cancelled') { core.innerHTML = icon('alert'); core.style.background = 'rgba(251,113,133,.25)'; }
  else core.textContent = t.ext;
  o.appendChild(core);
  return o;
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
  if (active.length) {
    dlSum.textContent = `${active.length} ${active.length === 1 ? 'файл' : 'файла'} · ` +
      (speed > 0 ? fmtBytes(speed) + '/с' : 'ожидание') +
      (total && speed > 0 ? ' · осталось ' + fmtTime((total - got) / speed) : '');
  } else {
    const done = dls.filter(d => d.state === 'completed').length;
    dlSum.textContent = dls.length ? `Готово: ${done} из ${dls.length}` : '';
  }

  // список рисуем, только когда панель открыта
  if (!panelOpen) return;
  dlList.textContent = '';
  dlEmpty.style.display = dls.length ? 'none' : '';
  for (const d of dls) {
    const failed = d.state === 'interrupted' || d.state === 'cancelled';
    const t = typeOf(d.name);
    const el = document.createElement('div');
    el.className = 'di ' + (failed ? 'failed' : d.state) + (d.paused ? ' paused' : '') +
      (d.state === 'progressing' && !d.total ? ' indet' : '');
    const body = document.createElement('div'); body.className = 'body';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = d.name; nm.title = d.name;
    body.appendChild(nm);
    const meta = document.createElement('div'); meta.className = 'meta';
    const acts = document.createElement('div'); acts.className = 'acts';
    if (d.state === 'progressing') {
      const bar = document.createElement('div'); bar.className = 'bar';
      const i = document.createElement('i');
      i.style.width = d.total ? Math.max(2, d.received / d.total * 100).toFixed(1) + '%' : '35%';
      bar.appendChild(i); body.appendChild(bar);
      const pct = d.total ? Math.floor(d.received / d.total * 100) + '% · ' : '';
      meta.textContent = pct + fmtBytes(d.received) + (d.total ? ' из ' + fmtBytes(d.total) : '');
      if (d.paused) meta.textContent += ' · пауза';
      else if (d.speed > 0) {
        const sp = document.createElement('span'); sp.className = 'sp';
        sp.textContent = ' · ' + fmtBytes(d.speed) + '/с';
        meta.appendChild(sp);
        if (d.total) { const left = fmtTime((d.total - d.received) / d.speed); if (left) meta.append(' · ' + left); }
      }
      acts.append(
        actBtn(d.paused ? 'play' : 'pause', d.paused ? 'Продолжить' : 'Пауза', 'dl:pause', d.id),
        actBtn('close', 'Отменить', 'dl:cancel', d.id, 'danger'),
      );
    } else if (d.state === 'completed') {
      meta.textContent = 'Готово · ' + fmtBytes(d.received);
      acts.append(actBtn('open', 'Открыть файл', 'dl:open', d.id), actBtn('folder', 'Показать в папке', 'dl:show', d.id));
      el.ondblclick = () => api.send('dl:open', d.id);
      el.title = 'Двойной клик — открыть';
    } else {
      meta.textContent = d.state === 'cancelled' ? 'Отменено' : 'Ошибка загрузки';
    }
    body.appendChild(meta);
    el.append(orb(d, t), body, acts);
    dlList.appendChild(el);
  }
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

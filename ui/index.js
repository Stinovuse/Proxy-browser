'use strict';
const $ = id => document.getElementById(id);
const tabsEl = $('tabs'), addr = $('addr'), ipEl = $('ip');
let state = [];
let loading = false;

function render() {
  tabsEl.querySelectorAll('.tab').forEach(n => n.remove());
  const plus = $('newtab');
  for (const t of state) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.active ? ' active' : '');
    el.title = t.title + '\n' + t.url;
    if (t.loading) { const s = document.createElement('span'); s.className = 'spin'; el.appendChild(s); }
    const title = document.createElement('span'); title.className = 't'; title.textContent = t.title;
    const x = document.createElement('span'); x.className = 'x'; x.textContent = '×'; x.title = 'Закрыть (Ctrl+W)';
    // Закрываем сразу по нажатию: при переключении вкладок панель перерисовывается,
    // и обычный click до крестика не доходил
    x.onmousedown = e => {
      e.stopPropagation(); e.preventDefault();
      if (e.button === 0 || e.button === 1) api.send('tab:close', t.id);
    };
    el.onmousedown = e => {
      if (e.button === 1) { e.preventDefault(); api.send('tab:close', t.id); }
      else if (e.button === 0 && !t.active) api.send('tab:switch', t.id);
    };
    el.append(title, x);
    tabsEl.insertBefore(el, plus);
  }
  const a = state.find(t => t.active);
  if (a) {
    if (document.activeElement !== addr) addr.value = a.url.startsWith('data:') ? '' : a.url;
    $('back').disabled = !a.canBack;
    $('fwd').disabled = !a.canFwd;
    loading = a.loading;
    const tr = $('tr');
    tr.classList.toggle('on', !!a.translated);
    tr.title = a.translated ? 'Показать оригинал (Ctrl+Shift+Y)' : 'Перевести страницу (Ctrl+Shift+Y)';
    const star = $('star');
    star.textContent = a.bookmarked ? '★' : '☆';
    star.classList.toggle('on', !!a.bookmarked);
    star.title = a.bookmarked ? 'Убрать из закладок (Ctrl+D)' : 'Добавить в закладки (Ctrl+D)';
    $('reload').textContent = loading ? '✕' : '⟳';
  }
}

api.on('tabs', s => { state = s; render(); });
const ipText = $('iptext');
api.on('proxy', st => {
  if (st.state === 'ok') {
    ipEl.className = st.tzMismatch ? 'warn' : 'ok';
    ipText.textContent = 'Прокси подключён · ' + (st.cc ? st.cc + ' · ' : '') + st.ip + ' · ' + st.ms + ' мс';
    ipEl.title = 'Прокси: ' + st.proxy + '\nВнешний IP: ' + st.ip +
      (st.country ? ' (' + st.country + ')' : '') + '\nЗадержка: ' + st.ms + ' мс' +
      (st.tzMismatch ? '\n\n⚠ Часовой пояс браузера (' + st.browserTz + ') не совпадает с поясом прокси (' +
        st.proxyTz + '). Его можно поменять в настройках.' : '') + '\n\nНажмите, чтобы проверить ещё раз';
  } else if (st.state === 'fail') {
    ipEl.className = 'bad';
    ipText.textContent = 'Нет подключения к прокси';
    ipEl.title = (st.proxy ? 'Прокси: ' + st.proxy + '\n' : '') + (st.error || '') +
      '\n\nПовторная попытка каждые 10 секунд. Нажмите, чтобы проверить сейчас.';
  } else {
    ipEl.className = 'wait';
    ipText.textContent = 'Подключение к прокси…';
    ipEl.title = 'Подключение к прокси…';
  }
});
api.on('focus-address', () => { addr.focus(); addr.select(); });
let toastTimer;
api.on('toast', msg => {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
});

// ---------- Закладки ----------
const bmEl = $('bm'), bmHint = $('bmhint');
let bookmarks = [];
const COLORS = ['#6c8cff', '#e07a5f', '#3fb68b', '#c77dff', '#f2a541', '#4ea8de', '#ef476f'];
function colorFor(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }

function renderBookmarks() {
  bmEl.querySelectorAll('.bm').forEach(n => n.remove());
  bmHint.style.display = bookmarks.length ? 'none' : '';
  bookmarks.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'bm';
    el.title = b.title + '\n' + b.url;
    const host = hostOf(b.url);
    const ic = document.createElement('span');
    ic.className = 'ic'; ic.style.background = colorFor(host);
    ic.textContent = (host[0] || '?').toUpperCase();
    const n = document.createElement('span'); n.className = 'n'; n.textContent = b.title || host;
    el.append(ic, n);
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
$('star').onclick = () => api.send('bm:toggle');
$('tr').onclick = () => api.send('tr:toggle');
api.on('update', u => {
  const b = $('upd');
  b.textContent = '⬆ Обновить до ' + u.version;
  b.style.display = '';
});
$('upd').onclick = () => api.send('update:install');

$('newtab').onclick = () => api.send('tab:new');
$('back').onclick = () => api.send('nav:back');
$('fwd').onclick = () => api.send('nav:fwd');
$('reload').onclick = () => api.send(loading ? 'nav:stop' : 'nav:reload');
$('settings').onclick = () => api.send('settings:open');
// ---------- Загрузки ----------
const dlBtn = $('dl'), dlList = $('dllist'), dlEmpty = $('dlempty');
const ring = dlBtn.querySelector('.ring'), ringBg = dlBtn.querySelector('.ring-bg'), badge = dlBtn.querySelector('.badge');
const RING_LEN = 75.4;
let dls = [];
let panelOpen = false;
let doneFlashTimer = null;

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
function btn(label, ch, id) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = (e) => { e.stopPropagation(); api.send(ch, id); };
  return b;
}

function renderDownloads() {
  // кнопка: общий прогресс активных загрузок
  const active = dls.filter(d => d.state === 'progressing');
  const known = active.filter(d => d.total > 0);
  const total = known.reduce((a, d) => a + d.total, 0);
  const got = known.reduce((a, d) => a + d.received, 0);
  if (active.length) {
    clearTimeout(doneFlashTimer);
    dlBtn.classList.remove('done');
    const frac = total ? got / total : 0.15;
    ring.setAttribute('opacity', '1'); ringBg.setAttribute('opacity', '1');
    ring.setAttribute('stroke-dashoffset', String(RING_LEN * (1 - frac)));
    badge.style.display = active.length > 1 ? '' : 'none';
    badge.textContent = active.length;
    dlBtn.title = 'Загрузки: ' + active.length + (total ? ' · ' + Math.floor(got / total * 100) + '%' : '');
  } else {
    badge.style.display = 'none';
    dlBtn.title = 'Загрузки';
    if (ring.getAttribute('opacity') === '1') {
      // всё скачалось — зелёное кольцо на пару секунд
      ring.setAttribute('stroke-dashoffset', '0');
      dlBtn.classList.add('done');
      clearTimeout(doneFlashTimer);
      doneFlashTimer = setTimeout(() => {
        ring.setAttribute('opacity', '0'); ringBg.setAttribute('opacity', '0'); dlBtn.classList.remove('done');
      }, 2500);
    }
  }

  // список
  dlList.textContent = '';
  dlEmpty.style.display = dls.length ? 'none' : '';
  for (const d of dls) {
    const failed = d.state === 'interrupted' || d.state === 'cancelled';
    const el = document.createElement('div');
    el.className = 'di ' + (d.state === 'completed' ? 'completed' : failed ? 'failed' : '') +
      (d.paused ? ' paused' : '') + (d.state === 'progressing' && !d.total ? ' indet' : '');
    const ext = (d.name.match(/\.([a-z0-9]{1,4})$/i) || [])[1] || 'файл';
    const fi = document.createElement('div'); fi.className = 'fi'; fi.textContent = ext;
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = d.name; nm.title = d.name;
    el.append(fi, nm);
    if (d.state === 'progressing') {
      const bar = document.createElement('div'); bar.className = 'bar';
      const i = document.createElement('i');
      i.style.width = d.total ? (d.received / d.total * 100).toFixed(1) + '%' : '30%';
      bar.appendChild(i); el.appendChild(bar);
    }
    const meta = document.createElement('div'); meta.className = 'meta';
    const info = document.createElement('span');
    if (d.state === 'progressing') {
      const parts = [fmtBytes(d.received) + (d.total ? ' из ' + fmtBytes(d.total) : '')];
      if (d.paused) parts.push('пауза');
      else if (d.speed > 0) {
        parts.push(fmtBytes(d.speed) + '/с');
        if (d.total) { const left = fmtTime((d.total - d.received) / d.speed); if (left) parts.push('осталось ' + left); }
      }
      info.textContent = parts.join(' · ');
      meta.append(info, btn(d.paused ? 'Продолжить' : 'Пауза', 'dl:pause', d.id), btn('Отмена', 'dl:cancel', d.id));
    } else if (d.state === 'completed') {
      info.textContent = 'Готово · ' + fmtBytes(d.received);
      meta.append(info, btn('Открыть', 'dl:open', d.id), btn('В папке', 'dl:show', d.id));
      el.ondblclick = () => api.send('dl:open', d.id);
    } else {
      info.textContent = d.state === 'cancelled' ? 'Отменено' : 'Ошибка загрузки';
      meta.append(info);
    }
    el.appendChild(meta);
    dlList.appendChild(el);
  }
}
api.on('downloads', list => { dls = list; renderDownloads(); });

function setPanel(open) {
  panelOpen = open;
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
ipEl.onclick = () => api.send('ip:check');
addr.addEventListener('keydown', e => {
  if (e.key === 'Enter') { api.send('nav:go', addr.value); addr.blur(); }
  if (e.key === 'Escape') { addr.blur(); render(); }
});
addr.addEventListener('focus', () => setTimeout(() => addr.select(), 0));

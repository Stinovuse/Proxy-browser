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
    x.onclick = e => { e.stopPropagation(); api.send('tab:close', t.id); };
    el.onmousedown = e => { if (e.button === 1) api.send('tab:close', t.id); else api.send('tab:switch', t.id); };
    el.append(title, x);
    tabsEl.insertBefore(el, plus);
  }
  const a = state.find(t => t.active);
  if (a) {
    if (document.activeElement !== addr) addr.value = a.url.startsWith('data:') ? '' : a.url;
    $('back').disabled = !a.canBack;
    $('fwd').disabled = !a.canFwd;
    loading = a.loading;
    const star = $('star');
    star.textContent = a.bookmarked ? '★' : '☆';
    star.classList.toggle('on', a.bookmarked);
    star.title = a.bookmarked ? 'Убрать из закладок (Ctrl+D)' : 'Добавить в закладки (Ctrl+D)';
    $('reload').textContent = loading ? '✕' : '⟳';
  }
}

api.on('tabs', s => { state = s; render(); });
api.on('ip', r => {
  ipEl.className = r.ok ? 'ok' : 'bad';
  ipEl.textContent = r.ok ? 'IP ' + r.ip : 'прокси недоступен';
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

$('newtab').onclick = () => api.send('tab:new');
$('back').onclick = () => api.send('nav:back');
$('fwd').onclick = () => api.send('nav:fwd');
$('reload').onclick = () => api.send(loading ? 'nav:stop' : 'nav:reload');
$('settings').onclick = () => api.send('settings:open');
$('dl').onclick = () => api.send('downloads:open');
ipEl.onclick = () => { ipEl.className = 'wait'; ipEl.textContent = 'проверка…'; api.send('ip:check'); };
addr.addEventListener('keydown', e => {
  if (e.key === 'Enter') { api.send('nav:go', addr.value); addr.blur(); }
  if (e.key === 'Escape') { addr.blur(); render(); }
});
addr.addEventListener('focus', () => setTimeout(() => addr.select(), 0));

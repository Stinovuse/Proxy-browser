'use strict';
// Стартовая страница S Browser. Данные (закладки, статус прокси) берёт с того же
// внутреннего адреса sbrowser://newtab/data.json; доступа к браузеру у неё нет.
const $ = (id) => document.getElementById(id);

function tick() {
  const d = new Date();
  $('clock').textContent = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const t = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  $('date').textContent = t.charAt(0).toUpperCase() + t.slice(1);
}
tick();
setInterval(tick, 1000);

// Адрес сайта — открываем сайт, иначе ищем в DuckDuckGo
$('search').addEventListener('submit', (e) => {
  const v = $('q').value.trim();
  if (!v) { e.preventDefault(); return; }
  if (/^https?:\/\//i.test(v)) { e.preventDefault(); location.href = v; return; }
  if (/^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(v)) { e.preventDefault(); location.href = 'https://' + v; }
});

const COLORS = ['#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1'];
function colorFor(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }

function renderTiles(list) {
  const box = $('tiles');
  box.textContent = '';
  if (!list.length) {
    const h = document.createElement('div');
    h.className = 'hint';
    h.innerHTML = 'Здесь появятся ваши закладки. Нажмите <b>★</b> в адресной строке, чтобы закрепить сайт.';
    box.appendChild(h);
    return;
  }
  list.slice(0, 12).forEach((b, i) => {
    if (!/^https?:/i.test(b.url)) return;
    const host = hostOf(b.url);
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = b.url;
    a.title = b.title + '\n' + b.url;
    a.style.animationDelay = (i * 35) + 'ms';
    const ic = document.createElement('span');
    ic.className = 'ic';
    const c = colorFor(host);
    ic.style.background = `linear-gradient(135deg, ${c}, ${c}99)`;
    ic.textContent = ((b.title || host).trim()[0] || '•').toUpperCase();
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = b.title || host;
    a.append(ic, n);
    box.appendChild(a);
  });
}

function renderProxy(p) {
  const el = $('proxy');
  if (!p || p.state === 'connecting') { el.className = 'chip'; $('ptext').textContent = 'Подключение к прокси…'; return; }
  if (p.state === 'fail') { el.className = 'chip bad'; $('ptext').textContent = 'Нет связи с прокси'; return; }
  el.className = 'chip ' + (p.warn ? 'warn' : 'ok');
  $('ptext').textContent = 'Через прокси' + (p.country ? ' · ' + p.country : '') + (p.ip ? ' · ' + p.ip : '');
}

async function load() {
  try {
    const r = await fetch('data.json', { cache: 'no-store' });
    const d = await r.json();
    renderTiles(d.bookmarks || []);
    renderProxy(d.proxy);
    return d.proxy && d.proxy.state;
  } catch { renderTiles([]); return null; }
}
load().then((st) => { if (st !== 'ok') setTimeout(load, 3000); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

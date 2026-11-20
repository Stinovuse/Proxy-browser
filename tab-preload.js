'use strict';
/*
 * Автоперевод страниц. Работает в изолированном мире (contextIsolation):
 * сайт не видит этот код и не может к нему обратиться. Сам перевод
 * запрашивает главный процесс — через прокси.
 */
const { ipcRenderer } = require('electron');

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'SELECT',
  'OPTION', 'SVG', 'MATH', 'KBD', 'SAMP', 'VAR', 'CANVAS', 'IFRAME', 'TEMPLATE']);
const MAX_NODES_PER_PASS = 4000;
const BATCH_ITEMS = 60;
const BATCH_CHARS = 2000;

let active = false;
let auto = false;
let target = 'ru';
let srcLang = null;
const orig = new Map();      // текстовый узел -> исходный текст
const done = new WeakMap();  // текстовый узел -> текст, который мы вставили
let observer = null;
let timer = null;
let pendingRoots = new Set();   // что изменилось на странице с прошлого прохода
let fullPass = true;
const skipCache = new WeakMap(); // элемент -> «внутри code/script/notranslate»
let busy = false;
let pending = false;

function report() {
  ipcRenderer.send('tr:state', { active, lang: srcLang });
}

// Можно ли переводить содержимое элемента (результат кэшируется на элемент)
function skipped(el) {
  if (!el) return true;
  const c = skipCache.get(el);
  if (c !== undefined) return c;
  const r = SKIP.has(el.tagName) || el.isContentEditable ||
    el.getAttribute('translate') === 'no' || el.classList.contains('notranslate') ||
    (el.parentElement ? skipped(el.parentElement) : false);
  skipCache.set(el, r);
  return r;
}

function eligible(node) {
  const v = node.nodeValue;
  if (!v || v.trim().length < 2 || !/\p{L}/u.test(v)) return false;
  if (done.get(node) === v) return false;
  return !skipped(node.parentElement);
}

function collect() {
  const out = [];
  if (!document.body) return out;
  const roots = fullPass ? [document.body] : [...pendingRoots];
  fullPass = false;
  pendingRoots = new Set();
  const seen = new Set();
  const take = (n) => {
    if (seen.has(n) || !eligible(n)) return;
    seen.add(n);
    // Сайт сам поменял текст узла — запоминаем новый оригинал
    if (orig.has(n) && done.get(n) !== n.nodeValue) orig.set(n, n.nodeValue);
    out.push(n);
  };
  for (const r of roots) {
    if (out.length >= MAX_NODES_PER_PASS) { fullPass = true; break; } // не успели — в следующий раз пройдём всё
    if (!r.isConnected) continue;
    if (r.nodeType === Node.TEXT_NODE) { take(r); continue; }
    if (r.nodeType !== Node.ELEMENT_NODE || skipped(r)) continue;
    const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode()) && out.length < MAX_NODES_PER_PASS) take(n);
  }
  return out;
}

function apply(node, translated) {
  if (!orig.has(node)) orig.set(node, node.nodeValue);
  const o = orig.get(node);
  const lead = o.match(/^\s*/)[0];
  const trail = o.match(/\s*$/)[0];
  const nv = lead + translated + trail;
  node.nodeValue = nv;
  done.set(node, nv);
}

function sameLang(a, b) {
  if (!a || !b) return false;
  return a.toLowerCase().split('-')[0] === b.toLowerCase().split('-')[0];
}

async function pass() {
  if (busy) { pending = true; return; }
  busy = true;
  try {
    for (const n of orig.keys()) if (!n.isConnected) orig.delete(n);
    const nodes = collect();
    let i = 0;
    while (i < nodes.length && active) {
      const batch = [];
      let len = 0;
      while (i < nodes.length && batch.length < BATCH_ITEMS && len < BATCH_CHARS) {
        const n = nodes[i++];
        batch.push(n);
        len += n.nodeValue.length;
      }
      const texts = batch.map(n => n.nodeValue.replace(/\s+/g, ' ').trim());
      const res = await ipcRenderer.invoke('tr:translate', texts, target);
      if (!active) break;
      if (!res || !res.ok) break;
      if (res.lang && !srcLang) {
        srcLang = res.lang;
        // Автоперевод, а страница уже на нужном языке — ничего не трогаем
        if (auto && sameLang(srcLang, target)) { stop(false); return; }
        report();
      }
      batch.forEach((n, k) => {
        const t = res.out[k];
        if (t && n.isConnected && n.nodeValue.replace(/\s+/g, ' ').trim() === texts[k]) apply(n, t);
      });
    }
  } catch {
    // сеть/прокси недоступны — молча прекращаем
  } finally {
    busy = false;
    if (pending && active) { pending = false; schedule(); }
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(pass, 700);
}

function start(isAuto) {
  if (active) return;
  active = true;
  auto = isAuto;
  if (!isAuto) srcLang = null;
  report();
  fullPass = true;
  observer = new MutationObserver((records) => {
    if (!active) return;
    for (const m of records) {
      if (m.type === 'characterData') pendingRoots.add(m.target);
      else for (const n of m.addedNodes) pendingRoots.add(n);
    }
    if (pendingRoots.size) schedule();
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  pass();
}

function stop(restore = true) {
  active = false;
  clearTimeout(timer);
  if (observer) { observer.disconnect(); observer = null; }
  if (restore) {
    for (const [n, o] of orig) {
      if (n.isConnected && done.get(n) === n.nodeValue) n.nodeValue = o;
    }
  }
  orig.clear();
  report();
}

ipcRenderer.on('tr:set', (_e, on) => { if (on) start(false); else stop(true); });

async function init() {
  if (!/^https?:$/.test(location.protocol)) return;
  let c;
  try { c = await ipcRenderer.invoke('tr:config', location.hostname); } catch { return; }
  if (!c) return;
  target = c.target || 'ru';
  const pageLang = (document.documentElement.getAttribute('lang') || '').trim();
  // Страницы входа/оплаты (есть поле пароля или карты) автоматически не переводим:
  // их текст не должен уходить в переводчик без вашего решения
  const sensitive = !!document.querySelector('input[type="password"], input[autocomplete^="cc-"]');
  if (c.auto && !c.excluded && !sensitive && !sameLang(pageLang, target)) start(true);
  else report();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();

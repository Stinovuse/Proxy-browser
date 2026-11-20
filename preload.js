'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const SEND = ['tab:new', 'tab:close', 'tab:switch', 'nav:go', 'nav:back', 'nav:fwd',
  'nav:reload', 'nav:stop', 'ip:check', 'settings:open', 'downloads:open',
  'bm:toggle', 'bm:open', 'bm:rename', 'bm:menu', 'tr:toggle', 'update:install'];
const INVOKE = ['settings:get', 'settings:save', 'data:clear'];
const ON = ['tabs', 'proxy', 'toast', 'focus-address', 'bookmarks', 'bm:rename-start', 'update'];

contextBridge.exposeInMainWorld('api', {
  send: (ch, ...a) => { if (SEND.includes(ch)) ipcRenderer.send(ch, ...a); },
  invoke: (ch, ...a) => INVOKE.includes(ch) ? ipcRenderer.invoke(ch, ...a) : Promise.reject(new Error('blocked')),
  on: (ch, fn) => { if (ON.includes(ch)) ipcRenderer.on(ch, (_e, d) => fn(d)); },
});

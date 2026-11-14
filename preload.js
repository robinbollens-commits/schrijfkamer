'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const aiListeners = new Set();
ipcRenderer.on('ai:event', (_e, msg) => aiListeners.forEach(fn => { try { fn(msg); } catch (err) { console.error(err); } }));

contextBridge.exposeInMainWorld('desktop', {
  store: {
    load: () => ipcRenderer.invoke('store:load'),
    set: (p, d) => ipcRenderer.invoke('store:set', p, d),
    del: p => ipcRenderer.invoke('store:del', p),
    flush: () => ipcRenderer.invoke('store:flush'),
    backup: (label, only) => ipcRenderer.invoke('store:backup', label, only),
    onChanged: fn => { const h = (_e, m) => fn(m); ipcRenderer.on('store:changed', h); return () => ipcRenderer.removeListener('store:changed', h); },
  },
  assets: {
    save: (bytes, type) => ipcRenderer.invoke('assets:save', bytes, type),
    del: id => ipcRenderer.invoke('assets:del', id),
    saveAs: (id, bytes, type) => ipcRenderer.invoke('assets:saveAs', id, bytes, type),
    list: () => ipcRenderer.invoke('assets:list'),
    read: id => ipcRenderer.invoke('assets:read', id),
  },
  files: {
    save: (filename, data) => ipcRenderer.invoke('files:save', filename, data),
    openDataDir: () => ipcRenderer.invoke('files:openDataDir'),
  },
  ai: {
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    setConfig: c => ipcRenderer.invoke('ai:setConfig', c),
    test: c => ipcRenderer.invoke('ai:test', c),
    models: c => ipcRenderer.invoke('ai:models', c),
    run: (id, req) => ipcRenderer.invoke('ai:run', id, req),
    cancel: id => ipcRenderer.invoke('ai:cancel', id),
    onEvent: fn => { aiListeners.add(fn); return () => aiListeners.delete(fn); },
  },
  version: () => ipcRenderer.invoke('app:version'),
  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
    choose: () => ipcRenderer.invoke('sync:choose'),
    enable: (dir, mode) => ipcRenderer.invoke('sync:enable', dir, mode),
    disable: () => ipcRenderer.invoke('sync:disable'),
    onStatus: fn => { const h = (_e, st) => fn(st); ipcRenderer.on('sync:status', h); return () => ipcRenderer.removeListener('sync:status', h); },
  },
  images: { openWindow: (id, title) => ipcRenderer.invoke('image:window', id, title) },
  spell: { set: lang => ipcRenderer.invoke('spell:set', lang), status: () => ipcRenderer.invoke('spell:status') },
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: fn => { const h = (_e, st) => fn(st); ipcRenderer.on('update:status', h); return () => ipcRenderer.removeListener('update:status', h); },
  },
});

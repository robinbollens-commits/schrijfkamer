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
  },
  assets: {
    save: (bytes, type) => ipcRenderer.invoke('assets:save', bytes, type),
    del: id => ipcRenderer.invoke('assets:del', id),
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
});

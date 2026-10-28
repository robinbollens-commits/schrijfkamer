'use strict';
// Updates via de Releases van de GitHub-repository (zie "publish" in package.json).
// De app meldt een nieuwe versie; één klik downloadt ze, installeert ze en start opnieuw.
const { app, ipcMain } = require('electron');

let autoUpdater = null, getWin = () => null, beforeInstall = async () => {};
let state = { state: 'idle' };

function send(next) {
  state = Object.assign({ version: state.version }, next);
  const w = getWin();
  if (w && !w.isDestroyed()) w.webContents.send('update:status', state);
}
const errText = e => {
  const m = String(e && e.message || e);
  if (/\b404\b|HttpError: 404/.test(m)) return 'Er zijn (nog) geen openbare updates te vinden.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_/.test(m)) return 'Geen internetverbinding.';
  return m.split('\n')[0].slice(0, 200);
};
const busy = () => ['downloading', 'installing'].includes(state.state);

async function check() {
  if (!autoUpdater || busy() || state.state === 'available') return state;
  try { await autoUpdater.checkForUpdates(); } catch (e) { send({ state: 'error', message: errText(e) }); }
  return state;
}

async function installNow() {
  send({ state: 'installing' });
  await beforeInstall();
  setImmediate(() => autoUpdater.quitAndInstall(true, true)); // stil installeren en daarna opnieuw starten
}

// De ene klik: downloaden (als dat nog moet), dan meteen installeren en herstarten.
async function update() {
  if (!autoUpdater || busy()) return state;
  if (state.state === 'ready') { await installNow(); return state; }
  if (state.state !== 'available') return state;
  send({ state: 'downloading', percent: 0 });
  try { await autoUpdater.downloadUpdate(); } catch (e) { send({ state: 'error', message: errText(e) }); }
  return state;
}

function init(opts) {
  getWin = opts.getWin; beforeInstall = opts.beforeInstall;
  ipcMain.handle('update:state', () => state);
  ipcMain.handle('update:check', () => check());
  ipcMain.handle('update:install', () => update());
  if (!app.isPackaged || process.env.SCHRIJFKAMER_NO_UPDATE) { state = { state: 'disabled' }; return; }

  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => { if (!busy()) send({ state: 'checking' }); });
  autoUpdater.on('update-available', i => send({ state: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'current' }));
  autoUpdater.on('download-progress', p => send({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', i => { send({ state: 'ready', version: i.version }); installNow().catch(() => {}); });
  autoUpdater.on('error', e => send({ state: 'error', message: errText(e) }));

  setTimeout(check, 8000);
  setInterval(check, 6 * 3600 * 1000);
}

module.exports = { init };

'use strict';
// Automatische updates via de Releases van de GitHub-repository (zie "publish" in package.json).
// Een update wordt op de achtergrond gedownload en geïnstalleerd bij afsluiten, of meteen via "Nu herstarten".
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

async function check() {
  if (!autoUpdater) return state;
  if (state.state === 'downloading' || state.state === 'ready') return state;
  try { await autoUpdater.checkForUpdates(); } catch (e) { send({ state: 'error', message: errText(e) }); }
  return state;
}

async function install() {
  if (!autoUpdater || state.state !== 'ready') return false;
  await beforeInstall();
  setImmediate(() => autoUpdater.quitAndInstall(true, true)); // stil installeren en daarna opnieuw starten
  return true;
}

function init(opts) {
  getWin = opts.getWin; beforeInstall = opts.beforeInstall;
  ipcMain.handle('update:state', () => state);
  ipcMain.handle('update:check', () => check());
  ipcMain.handle('update:install', () => install());
  if (!app.isPackaged || process.env.SCHRIJFKAMER_NO_UPDATE) { state = { state: 'disabled' }; return; }

  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', i => send({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => send({ state: 'current' }));
  autoUpdater.on('download-progress', p => send({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', i => send({ state: 'ready', version: i.version }));
  autoUpdater.on('error', e => send({ state: 'error', message: errText(e) }));

  setTimeout(check, 8000);
  setInterval(check, 6 * 3600 * 1000);
}

module.exports = { init };

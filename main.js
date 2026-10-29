'use strict';
const { app, BrowserWindow, protocol, ipcMain, dialog, shell, Menu, safeStorage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ai = require('./ai');
const updater = require('./updater');

const SCHEME = 'app';
const HOST = 'schrijfkamer';
const RENDERER = path.join(__dirname, 'renderer');

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

/* ---------- paden ---------- */
// SCHRIJFKAMER_DATA laat tests een eigen map gebruiken.
if (process.env.SCHRIJFKAMER_DATA) app.setPath('userData', path.resolve(process.env.SCHRIJFKAMER_DATA));
const dataDir = () => app.getPath('userData');
const docsFile = () => path.join(dataDir(), 'schrijfkamer-data.json');
const configFile = () => path.join(dataDir(), 'instellingen.json');
const assetDir = () => path.join(dataDir(), 'afbeeldingen');
const backupDir = () => path.join(dataDir(), 'reservekopieen');

function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) { if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; } // virusscanners houden bestanden soms even vast
    const until = Date.now() + 50 * (i + 1); while (Date.now() < until) { /* kort wachten */ }
  }
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

/* ---------- documenten ---------- */
let docs = {};
let dirty = false, saveTimer = null;
function loadDocs() {
  const f = docsFile();
  if (!fs.existsSync(f)) { docs = {}; return; }
  const parsed = readJson(f, null);
  if (parsed && typeof parsed.docs === 'object') { docs = parsed.docs; return; }
  // Kapot bestand: apart zetten en terugvallen op de jongste reservekopie.
  const broken = f.replace(/\.json$/, `-beschadigd-${Date.now()}.json`);
  try { fs.copyFileSync(f, broken); } catch (e) {}
  const last = listBackups().pop();
  const restored = last && readJson(path.join(backupDir(), last), null);
  docs = (restored && restored.docs) || {};
  dialog.showMessageBoxSync({ type: 'warning', title: 'Schrijfkamer', buttons: ['OK'],
    message: 'Je gegevensbestand kon niet worden gelezen.',
    detail: last ? `De reservekopie ${last} is teruggezet. Het beschadigde bestand staat apart in je gegevensmap.` : 'Er was geen reservekopie. Het beschadigde bestand staat apart in je gegevensmap.' });
}
function saveDocsNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!dirty) return;
  writeAtomic(docsFile(), JSON.stringify({ format: 'schrijfkamer-data', version: 1, savedAt: new Date().toISOString(), docs }));
  dirty = false;
}
function scheduleSave() { dirty = true; if (!saveTimer) saveTimer = setTimeout(() => { try { saveDocsNow(); } catch (e) { console.error(e); } }, 400); }

/* ---------- dagelijkse reservekopie ---------- */
function listBackups() {
  try { return fs.readdirSync(backupDir()).filter(n => /^schrijfkamer-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort(); } catch (e) { return []; }
}
function dailyBackup() {
  if (!fs.existsSync(docsFile())) return;
  fs.mkdirSync(backupDir(), { recursive: true });
  const d = new Date(), key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const target = path.join(backupDir(), `schrijfkamer-${key}.json`);
  if (!fs.existsSync(target)) fs.copyFileSync(docsFile(), target);
  const all = listBackups();
  all.slice(0, Math.max(0, all.length - 14)).forEach(n => { try { fs.unlinkSync(path.join(backupDir(), n)); } catch (e) {} });
}

/* ---------- afbeeldingen ---------- */
const MIME_EXT = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));
function assetPath(id) {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  try { const n = fs.readdirSync(assetDir()).find(f => f.startsWith(id + '.')); return n ? path.join(assetDir(), n) : null; } catch (e) { return null; }
}

/* ---------- spellingscontrole ---------- */
// Chromium zoekt woordenboeken in <userData>/Dictionaries en downloadt ze anders van een CDN.
// Die download mislukt soms zonder melding, dus de app levert ze zelf mee.
function installDictionaries() {
  const src = app.isPackaged ? path.join(process.resourcesPath, 'dictionaries') : path.join(__dirname, 'dictionaries');
  const dst = path.join(dataDir(), 'Dictionaries');
  try {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      if (f.endsWith('.bdic') && !fs.existsSync(path.join(dst, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
    }
  } catch (e) { console.error('woordenboeken', e); }
}
const spellState = {};

/* ---------- instellingen en sleutels ---------- */
const DEFAULT_CFG = { provider: 'none', model: 'claude-opus-5-5', ollamaUrl: 'http://localhost:11434', ollamaModel: '', numCtx: 16384, oaiUrl: 'http://localhost:1234/v1', oaiModel: '' };
function loadConfig() { return Object.assign({}, DEFAULT_CFG, readJson(configFile(), {})); }
function seal(text) {
  if (safeStorage.isEncryptionAvailable()) return { enc: 'safe', v: safeStorage.encryptString(text).toString('base64') };
  return { enc: 'plain', v: Buffer.from(text, 'utf8').toString('base64') };
}
function unseal(s) {
  if (!s || !s.v) return '';
  try { return s.enc === 'safe' ? safeStorage.decryptString(Buffer.from(s.v, 'base64')) : Buffer.from(s.v, 'base64').toString('utf8'); } catch (e) { return ''; }
}
function publicConfig(c) {
  const { apiKeySealed, oaiKeySealed, ...rest } = c;
  return Object.assign(rest, { hasKey: !!(apiKeySealed && apiKeySealed.v), hasOaiKey: !!(oaiKeySealed && oaiKeySealed.v) });
}
// Instellingen uit het venster, met eventueel nieuwe sleutels, samengevoegd met wat al bewaard is.
function mergeConfig(input) {
  const cur = loadConfig(), out = Object.assign({}, cur);
  for (const k of Object.keys(DEFAULT_CFG)) if (input && input[k] !== undefined) out[k] = input[k];
  out.numCtx = Math.max(2048, Math.min(262144, Number(out.numCtx) || 16384));
  if (input && typeof input.apiKey === 'string' && input.apiKey.trim()) out.apiKeySealed = seal(input.apiKey.trim());
  if (input && typeof input.oaiKey === 'string' && input.oaiKey.trim()) out.oaiKeySealed = seal(input.oaiKey.trim());
  return out;
}
function runtimeConfig(c) { return Object.assign({}, c, { apiKey: unseal(c.apiKeySealed), oaiKey: unseal(c.oaiKeySealed) }); }

/* ---------- venster ---------- */
let win = null, closing = false;
// Laat het venster zijn openstaande wijzigingen wegschrijven en bewaar daarna alles op schijf.
async function flushWindow() {
  if (win && !win.isDestroyed()) {
    await Promise.race([win.webContents.executeJavaScript('window.__skFlush ? window.__skFlush() : true', true), new Promise(r => setTimeout(r, 4000))]).catch(() => {});
  }
  try { saveDocsNow(); } catch (err) { console.error(err); }
}
function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 900, minHeight: 600, show: false,
    backgroundColor: '#14110E', title: 'Schrijfkamer', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(`${SCHEME}://${HOST}/index.html`);

  const wc = win.webContents;
  wc.session.on('spellcheck-dictionary-initialized', (_e, l) => { spellState[l] = 'ok'; });
  wc.session.on('spellcheck-dictionary-download-failure', (_e, l) => { if (spellState[l] !== 'ok') spellState[l] = 'failed'; });
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:|^mailto:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!url.startsWith(`${SCHEME}://${HOST}/`)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  wc.session.setPermissionRequestHandler((_wc, perm, cb) => cb(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen'].includes(perm)));
  if (process.platform !== 'win32' && process.platform !== 'darwin') wc.session.setSpellCheckerLanguages(['nl', 'en-US']);
  wc.on('context-menu', (_e, p) => {
    const items = [];
    if (p.misspelledWord) {
      p.dictionarySuggestions.slice(0, 6).forEach(s => items.push({ label: s, click: () => wc.replaceMisspelling(s) }));
      if (!p.dictionarySuggestions.length) items.push({ label: 'Geen suggesties', enabled: false });
      items.push({ label: 'Voeg toe aan woordenboek', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' });
    }
    if (p.isEditable) items.push({ label: 'Knippen', role: 'cut', enabled: p.editFlags.canCut }, { label: 'Kopiëren', role: 'copy', enabled: p.editFlags.canCopy },
      { label: 'Plakken', role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' }, { label: 'Alles selecteren', role: 'selectAll' });
    else if (p.selectionText) items.push({ label: 'Kopiëren', role: 'copy' });
    if (p.linkURL && /^https?:/.test(p.linkURL)) items.push({ label: 'Link kopiëren', click: () => clipboard.writeText(p.linkURL) });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Bij sluiten eerst de schrijfwachtrij van het venster leegmaken.
  win.on('close', e => {
    if (closing) return;
    e.preventDefault(); closing = true;
    flushWindow().then(() => { if (win && !win.isDestroyed()) win.destroy(); });
  });
  win.on('closed', () => { win = null; BrowserWindow.getAllWindows().forEach(w => w.close()); }); // afbeeldingsvensters sluiten mee
}

function buildMenu() {
  const tpl = [
    { label: 'Bestand', submenu: [
      { label: 'Gegevensmap openen', click: () => shell.openPath(dataDir()) },
      { label: 'Map met reservekopieën openen', click: () => { fs.mkdirSync(backupDir(), { recursive: true }); shell.openPath(backupDir()); } },
      { type: 'separator' }, { label: 'Afsluiten', role: 'quit' } ] },
    { label: 'Bewerken', submenu: [
      { label: 'Ongedaan maken', role: 'undo' }, { label: 'Opnieuw', role: 'redo' }, { type: 'separator' },
      { label: 'Knippen', role: 'cut' }, { label: 'Kopiëren', role: 'copy' }, { label: 'Plakken', role: 'paste' }, { label: 'Alles selecteren', role: 'selectAll' } ] },
    { label: 'Beeld', submenu: [
      { label: 'Groter', role: 'zoomIn', accelerator: 'CommandOrControl+=' }, { label: 'Kleiner', role: 'zoomOut' }, { label: 'Normale grootte', role: 'resetZoom' },
      { type: 'separator' }, { label: 'Volledig scherm', role: 'togglefullscreen' }, { label: 'Opnieuw laden', role: 'reload' },
      { label: 'Ontwikkelaarshulpmiddelen', role: 'toggleDevTools' } ] },
    { label: 'Help', submenu: [
      { label: 'Over Schrijfkamer', click: () => dialog.showMessageBox(win, { type: 'info', title: 'Schrijfkamer', message: `Schrijfkamer ${app.getVersion()}`,
        detail: `Je boeken staan in:\n${dataDir()}\n\nElectron ${process.versions.electron}` }) } ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

/* ---------- protocol ---------- */
function serve(req) {
  const u = new URL(req.url);
  if (u.host !== HOST) return new Response('Niet gevonden', { status: 404 });
  const p = decodeURIComponent(u.pathname);
  const blob = p.match(/^\/_blob\/([0-9a-f]{32})$/);
  if (blob) {
    const f = assetPath(blob[1]);
    if (!f) return new Response('Niet gevonden', { status: 404 });
    const type = EXT_MIME[path.extname(f).slice(1)] || 'application/octet-stream';
    return new Response(fs.readFileSync(f), { headers: { 'content-type': type, 'cache-control': 'max-age=31536000, immutable' } });
  }
  const f = path.normalize(path.join(RENDERER, p === '/' ? 'index.html' : p));
  if (!f.startsWith(RENDERER + path.sep) || !fs.existsSync(f)) return new Response('Niet gevonden', { status: 404 });
  const type = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', woff2: 'font/woff2', png: 'image/png', svg: 'image/svg+xml', json: 'application/json' }[path.extname(f).slice(1)] || 'application/octet-stream';
  return new Response(fs.readFileSync(f), { headers: { 'content-type': type } });
}

/* ---------- IPC ---------- */
function ipc() {
  ipcMain.handle('store:load', () => docs);
  ipcMain.handle('store:set', (_e, p, d) => { if (typeof p !== 'string') throw new Error('pad'); docs[p] = d; scheduleSave(); return true; });
  ipcMain.handle('store:del', (_e, p) => { delete docs[p]; scheduleSave(); return true; });
  ipcMain.handle('store:flush', () => { saveDocsNow(); return true; });

  ipcMain.handle('assets:save', (_e, bytes, type) => {
    const ext = MIME_EXT[type]; if (!ext) throw Object.assign(new Error('Dit soort afbeelding wordt niet ondersteund.'), { code: 'unsupported_type' });
    const buf = Buffer.from(bytes); if (buf.length > 15 * 1024 * 1024) throw Object.assign(new Error('Te groot'), { code: 'too_large' });
    fs.mkdirSync(assetDir(), { recursive: true });
    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(assetDir(), `${id}.${ext}`), buf);
    return { id, url: `/_blob/${id}`, type, size: buf.length };
  });
  ipcMain.handle('assets:del', (_e, id) => { const f = assetPath(String(id)); if (f) fs.unlinkSync(f); return true; });

  ipcMain.handle('files:save', async (_e, filename, data) => {
    const safe = String(filename || 'schrijfkamer.txt').replace(/[\\/:*?"<>|]+/g, '-');
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), safe) });
    if (r.canceled || !r.filePath) return { saved: false };
    fs.writeFileSync(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
    return { saved: true, path: r.filePath };
  });
  ipcMain.handle('files:openDataDir', () => shell.openPath(dataDir()));
  ipcMain.handle('app:version', () => app.getVersion());
  // Een afbeelding in een eigen venster, om naast de tekst of op een tweede scherm te zetten.
  ipcMain.handle('image:window', (_e, id, title) => {
    if (!/^[0-9a-f]{32}$/.test(String(id)) || !assetPath(id)) return false;
    const w = new BrowserWindow({ width: 900, height: 1000, title: String(title || 'Afbeelding').slice(0, 120), backgroundColor: '#14110E', autoHideMenuBar: true,
      icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', e => e.preventDefault());
    w.on('page-title-updated', e => e.preventDefault());
    w.loadURL(`${SCHEME}://${HOST}/_blob/${id}`);
    return true;
  });
  // Spellingscontrole volgt de taal van het open boek (op macOS kiest het systeem zelf).
  const SPELL = { nl: ['nl', 'nl-NL', 'nl-BE'], en: ['en-US', 'en-GB', 'en'], fr: ['fr', 'fr-FR'], de: ['de', 'de-DE'], es: ['es', 'es-ES', 'es-419'], it: ['it', 'it-IT'], pt: ['pt-PT', 'pt-BR', 'pt'] };
  ipcMain.handle('spell:set', (e, lang) => {
    if (process.platform === 'darwin') return [];
    const ses = e.sender.session, have = ses.availableSpellCheckerLanguages || [];
    const pick = (SPELL[lang] || []).find(l => have.includes(l));
    if (pick) ses.setSpellCheckerLanguages([pick]);
    return { langs: ses.getSpellCheckerLanguages(), state: spellState };
  });
  ipcMain.handle('spell:status', e => ({ enabled: e.sender.session.isSpellCheckerEnabled(), langs: e.sender.session.getSpellCheckerLanguages(), state: spellState }));

  ipcMain.handle('ai:getConfig', () => publicConfig(loadConfig()));
  ipcMain.handle('ai:setConfig', (_e, input) => { const c = mergeConfig(input); writeAtomic(configFile(), JSON.stringify(c, null, 2)); return publicConfig(c); });
  ipcMain.handle('ai:test', (_e, input) => ai.test(runtimeConfig(mergeConfig(input))));
  ipcMain.handle('ai:models', (_e, input) => ai.models(runtimeConfig(mergeConfig(input))));
  ipcMain.handle('ai:run', (e, id, req) => {
    const send = msg => { if (!e.sender.isDestroyed()) e.sender.send('ai:event', Object.assign({ id }, msg)); };
    ai.run(id, runtimeConfig(loadConfig()), req, send);
    return true;
  });
  ipcMain.handle('ai:cancel', (_e, id) => { ai.cancel(id); return true; });
}

/* ---------- start ---------- */
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  fs.mkdirSync(dataDir(), { recursive: true });
  try { dailyBackup(); } catch (e) { console.error('reservekopie', e); }
  loadDocs();
  installDictionaries();
  protocol.handle(SCHEME, serve);
  ipc();
  buildMenu();
  createWindow();
  updater.init({ getWin: () => win, beforeInstall: async () => { await flushWindow(); closing = true; } });
});
app.on('window-all-closed', () => { try { saveDocsNow(); } catch (e) {} app.quit(); });
app.on('before-quit', () => { try { saveDocsNow(); } catch (e) {} });

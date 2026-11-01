'use strict';
// Synchroniseren via een gedeelde map (Google Drive voor computers, OneDrive, Dropbox …).
// Elk document is een eigen bestand in <map>/Schrijfkamer/docs. De cloudsoftware brengt de map naar de
// andere computers; deze module schrijft eigen wijzigingen weg en leest die van de andere computers in.
const fs = require('fs');
const path = require('path');

const POLL_MS = 4000;
const PRESENT_MS = 30000;

let root = null, device = null, deviceName = '', onRemote = () => {}, onStatus = () => {};
let seen = new Map();          // bestandsnaam → "mtime:grootte" van wat we al kennen
let pending = {};              // pad → tijdstip (of {del:tijdstip}) van wijzigingen die nog niet in de map staan
let online = false, timer = null, presTimer = null, lastSync = 0, others = [];

const docsDir = () => path.join(root, 'docs');
const assetsDir = () => path.join(root, 'afbeeldingen');
const presDir = () => path.join(root, 'aanwezig');
const fileFor = p => p.split('/').join('~') + '.json';
// Conflictkopieën van de cloudsoftware ("naam (1).json") horen bij hetzelfde document.
const baseOf = name => name.replace(/ \(\d+\)(?=\.json$)/, '');
const stamp = st => `${st.mtimeMs}:${st.size}`;

function available() { try { return fs.statSync(docsDir()).isDirectory(); } catch (e) { return false; } }

function writeFileAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) { if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; }
    const until = Date.now() + 60 * (i + 1); while (Date.now() < until) { /* even wachten */ }
  }
}

// Leest de hele map in: pad → {data, updatedAt, device}. Bij conflictkopieën wint de nieuwste.
function readAll() {
  const out = {}, names = fs.readdirSync(docsDir()).filter(n => n.endsWith('.json'));
  const next = new Map();
  for (const n of names) {
    let rec;
    try { const f = path.join(docsDir(), n); next.set(n, stamp(fs.statSync(f))); rec = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
    if (!rec || rec.format !== 'schrijfkamer-doc' || typeof rec.path !== 'string') continue;
    const cur = out[rec.path];
    if (!cur || (rec.updatedAt || 0) > (cur.updatedAt || 0)) out[rec.path] = rec;
  }
  seen = next;
  return out;
}

function writeDoc(p, data) {
  const at = Date.now();
  const f = path.join(docsDir(), fileFor(p));
  writeFileAtomic(f, JSON.stringify({ format: 'schrijfkamer-doc', path: p, updatedAt: at, device: deviceName, data }));
  seen.set(fileFor(p), stamp(fs.statSync(f)));
}
function removeDoc(p) {
  const n = fileFor(p);
  try { fs.unlinkSync(path.join(docsDir(), n)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  seen.delete(n);
}

/* ---------- eigen wijzigingen ---------- */
function push(p, data) {
  if (!root) return;
  if (online) { try { writeDoc(p, data); delete pending[p]; return; } catch (e) { setOnline(false); } }
  pending[p] = Date.now();
}
function remove(p) {
  if (!root) return;
  if (online) { try { removeDoc(p); delete pending[p]; return; } catch (e) { setOnline(false); } }
  pending[p] = { del: Date.now() };
}

// Wijzigingen van terwijl de map onbereikbaar was. Een nieuwere versie in de map wint; de eigen versie
// wordt dan aan de aanroeper teruggegeven zodat die ze als reservekopie kan bewaren.
function flushPending(localDocs) {
  const lost = {};
  for (const [p, v] of Object.entries(pending)) {
    const at = typeof v === 'object' ? v.del : v;
    let remoteAt = 0;
    try { const r = JSON.parse(fs.readFileSync(path.join(docsDir(), fileFor(p)), 'utf8')); remoteAt = r.updatedAt || 0; } catch (e) {}
    if (remoteAt > at) { if (localDocs[p] !== undefined) lost[p] = localDocs[p]; }
    else if (typeof v === 'object') removeDoc(p);
    else if (localDocs[p] !== undefined) writeDoc(p, localDocs[p]);
    delete pending[p];
  }
  return lost;
}

/* ---------- wijzigingen van andere computers ---------- */
function scan(localDocs) {
  let names;
  try { names = fs.readdirSync(docsDir()).filter(n => n.endsWith('.json')); } catch (e) { setOnline(false); return; }
  const now = new Set(names), changed = new Set();
  for (const n of names) {
    let st; try { st = fs.statSync(path.join(docsDir(), n)); } catch (e) { continue; }
    if (seen.get(n) !== stamp(st)) { changed.add(baseOf(n)); seen.set(n, stamp(st)); }
  }
  for (const n of [...seen.keys()]) if (!now.has(n)) { seen.delete(n); if (!now.has(baseOf(n))) changed.add(baseOf(n)); }
  for (const base of changed) {
    // de nieuwste van het bestand en zijn eventuele conflictkopieën
    let best = null;
    for (const n of names) {
      if (baseOf(n) !== base) continue;
      try { const r = JSON.parse(fs.readFileSync(path.join(docsDir(), n), 'utf8')); if (r && r.format === 'schrijfkamer-doc' && (!best || (r.updatedAt || 0) > (best.updatedAt || 0))) best = r; } catch (e) {}
    }
    const p = best ? best.path : base.replace(/\.json$/, '').split('~').join('/');
    if (pending[p]) continue; // eigen, nog niet weggeschreven wijziging gaat voor
    const cur = localDocs[p];
    if (best && JSON.stringify(cur) === JSON.stringify(best.data)) continue;
    if (!best && cur === undefined) continue;
    onRemote(p, best ? best.data : null);
  }
  lastSync = Date.now();
}

// Volledige vergelijking bij (her)verbinden: de map is de waarheid, behalve voor eigen wachtende wijzigingen.
function reconcile(localDocs) {
  const remote = readAll();
  for (const [p, rec] of Object.entries(remote)) {
    if (pending[p]) continue;
    if (JSON.stringify(localDocs[p]) !== JSON.stringify(rec.data)) onRemote(p, rec.data);
  }
  for (const p of Object.keys(localDocs)) if (!(p in remote) && !pending[p]) onRemote(p, null);
  lastSync = Date.now();
}

/* ---------- aanwezigheid ---------- */
function presence() {
  if (!root || !online) return;
  try {
    fs.mkdirSync(presDir(), { recursive: true });
    writeFileAtomic(path.join(presDir(), device + '.json'), JSON.stringify({ name: deviceName, at: Date.now() }));
    others = fs.readdirSync(presDir()).filter(n => n.endsWith('.json') && n !== device + '.json').map(n => {
      try { return JSON.parse(fs.readFileSync(path.join(presDir(), n), 'utf8')); } catch (e) { return null; }
    }).filter(x => x && Date.now() - x.at < PRESENT_MS * 3).map(x => x.name);
  } catch (e) {}
  status();
}
function leave() { if (root && device) try { fs.unlinkSync(path.join(presDir(), device + '.json')); } catch (e) {} }

function status() { onStatus({ enabled: !!root, dir: root ? path.dirname(root) : '', online, others, lastSync, pending: Object.keys(pending).length }); }
function setOnline(v) { if (online !== v) { online = v; status(); } }

/* ---------- starten en stoppen ---------- */
// localDocs wordt door de aanroeper bijgehouden; onRemote(pad, data|null) past het aan.
function start(opts) {
  stop();
  root = path.join(opts.dir, 'Schrijfkamer'); device = opts.device; deviceName = opts.deviceName;
  onRemote = opts.onRemote; onStatus = opts.onStatus; pending = Object.assign({}, opts.pending || {});
  const tick = () => {
    const was = online, now = available();
    if (now && !was) {
      setOnline(true);
      const lost = flushPending(opts.getDocs());
      if (Object.keys(lost).length && opts.onLost) opts.onLost(lost);
      reconcile(opts.getDocs());
      presence();
      return;
    }
    if (!now) { setOnline(false); return; }
    scan(opts.getDocs());
    status();
  };
  online = false; tick();
  timer = setInterval(tick, POLL_MS);
  presTimer = setInterval(presence, PRESENT_MS);
}
function stop() { clearInterval(timer); clearInterval(presTimer); timer = presTimer = null; leave(); root = null; online = false; others = []; }

// Eerste keer koppelen. mode 'upload': de map is leeg; 'use': neem de map over; 'merge': map plus eigen documenten die er nog niet in staan.
function link(dir, localDocs, mode, localAssetDir) {
  const r = path.join(dir, 'Schrijfkamer');
  for (const d of ['docs', 'afbeeldingen', 'aanwezig']) fs.mkdirSync(path.join(r, d), { recursive: true });
  const prevRoot = root; root = r;
  try {
    const remote = readAll(), result = {};
    for (const [p, rec] of Object.entries(remote)) result[p] = rec.data;
    if (mode !== 'use') for (const [p, d] of Object.entries(localDocs)) if (!(p in result)) { writeDoc(p, d); result[p] = d; }
    // afbeeldingen meenemen naar de map
    try { for (const f of fs.readdirSync(localAssetDir)) { const t = path.join(assetsDir(), f); if (!fs.existsSync(t)) fs.copyFileSync(path.join(localAssetDir, f), t); } } catch (e) {}
    return result;
  } finally { root = prevRoot; }
}
// Telt hoeveel documenten er al in een map staan (om te weten of we moeten vragen wat te doen).
function inspect(dir) {
  try { return fs.readdirSync(path.join(dir, 'Schrijfkamer', 'docs')).filter(n => n.endsWith('.json')).length; } catch (e) { return 0; }
}

module.exports = {
  start, stop, push, remove, link, inspect,
  assetsDir: () => (root ? assetsDir() : null),
  isOnline: () => online,
  pending: () => Object.assign({}, pending),
  status: () => ({ enabled: !!root, dir: root ? path.dirname(root) : '', online, others, lastSync, pending: Object.keys(pending).length }),
};

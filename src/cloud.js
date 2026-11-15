/* Schrijfkamer cloud: inloggen en synchroniseren via Firebase (Firestore + Authentication).
   Gedeeld door de desktopapp en de webapp. Actief zodra window.SK_FIREBASE een configuratie bevat.
   Elke gebruiker heeft zijn eigen gegevens onder data/users/<uid>; de beveiligingsregels laten
   niemand anders erbij. */
(function () {
  'use strict';
  const CFG = window.SK_FIREBASE;
  if (!CFG || !window.firebase) return;

  const app = firebase.initializeApp(CFG);
  const auth = firebase.auth();
  const db = firebase.firestore();
  if (CFG.emulator) {
    auth.useEmulator(CFG.emulator.auth);
    db.useEmulator(CFG.emulator.firestoreHost, CFG.emulator.firestorePort);
  }
  // Werkt offline verder; wijzigingen gaan mee zodra er weer verbinding is.
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

  const LOCAL_PREFIX = 'data/users/desktop/';
  const err = (code, message) => Object.assign(new Error(message || code), { code });

  /* ---------- inlogscherm ---------- */
  const MSG = {
    'auth/invalid-email': 'Dat e-mailadres klopt niet.',
    'auth/missing-password': 'Vul je wachtwoord in.',
    'auth/weak-password': 'Kies een wachtwoord van minstens 6 tekens.',
    'auth/email-already-in-use': 'Er bestaat al een account met dit e-mailadres. Log in.',
    'auth/invalid-credential': 'E-mailadres of wachtwoord klopt niet.',
    'auth/wrong-password': 'E-mailadres of wachtwoord klopt niet.',
    'auth/user-not-found': 'Er is geen account met dit e-mailadres. Maak er een aan.',
    'auth/too-many-requests': 'Te veel pogingen. Wacht even en probeer opnieuw.',
    'auth/network-request-failed': 'Geen verbinding met internet. De eerste keer inloggen moet online.',
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let overlay = null;
  function showOverlay(html) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sk-login';
      overlay.setAttribute('role', 'dialog');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:var(--paper,#14110E);color:var(--ink,#ECE3D2);padding:16px;font-family:var(--f-ui,system-ui)';
      (document.body || document.documentElement).appendChild(overlay);
    }
    overlay.innerHTML = `<div style="width:min(420px,100%);background:var(--surface,#1D1915);border:1px solid var(--line,#362D26);border-radius:14px;padding:28px 26px;display:grid;gap:14px">
      <div style="display:flex;align-items:center;gap:10px;font-weight:700;font-size:19px"><span style="font-family:var(--f-ms,serif);font-size:30px;color:var(--pencil,#C9A45C)">¶</span>Schrijfkamer</div>${html}</div>`;
    return overlay;
  }
  function hideOverlay() { if (overlay) { overlay.remove(); overlay = null; } }
  const field = (id, label, type, extra = '') => `<label style="display:grid;gap:5px;font-size:13px;font-weight:600">${label}<input id="${id}" type="${type}" ${extra} style="font:inherit;font-weight:400;padding:10px 12px;border-radius:8px;border:1px solid var(--line,#362D26);background:var(--sunk,#0E0C0A);color:inherit"></label>`;
  const button = (id, label, primary) => `<button id="${id}" type="submit" style="font:inherit;font-weight:600;padding:10px 14px;border-radius:9px;cursor:pointer;border:1px solid ${primary ? 'transparent' : 'var(--line,#362D26)'};background:${primary ? 'var(--pencil,#C9A45C)' : 'transparent'};color:${primary ? 'var(--on-pencil,#1A140D)' : 'inherit'}">${label}</button>`;

  function loginForm(mode, note) {
    const create = mode === 'create';
    const el = showOverlay(`
      <p style="margin:0;color:var(--muted,#B4A792);font-size:14px">${create ? 'Maak een account aan. Je boeken worden dan bewaard in je account en zijn op al je toestellen dezelfde.' : 'Log in om je boeken op al je toestellen te openen.'}</p>
      <form id="sk-form" style="display:grid;gap:12px" novalidate>
        ${field('sk-email', 'E-mailadres', 'email', 'autocomplete="email" required')}
        ${field('sk-pass', 'Wachtwoord', 'password', `autocomplete="${create ? 'new-password' : 'current-password'}" required minlength="6"`)}
        ${create ? field('sk-pass2', 'Wachtwoord herhalen', 'password', 'autocomplete="new-password" required') : ''}
        <p id="sk-msg" role="status" style="margin:0;min-height:1.2em;font-size:13px;color:${note ? 'var(--ok,#8fbf7f)' : 'var(--bad,#e07a6a)'}">${esc(note || '')}</p>
        ${button('sk-go', create ? 'Account aanmaken' : 'Inloggen', true)}
      </form>
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px">
        <a href="#" id="sk-switch" style="color:var(--pencil,#C9A45C)">${create ? 'Ik heb al een account' : 'Nieuw? Maak een account'}</a>
        ${create ? '' : '<a href="#" id="sk-forgot" style="color:var(--muted,#B4A792)">Wachtwoord vergeten?</a>'}
      </div>`);
    const msg = t => { el.querySelector('#sk-msg').style.color = 'var(--bad,#e07a6a)'; el.querySelector('#sk-msg').textContent = t; };
    el.querySelector('#sk-email').focus();
    el.querySelector('#sk-switch').onclick = e => { e.preventDefault(); loginForm(create ? 'login' : 'create'); };
    const forgot = el.querySelector('#sk-forgot');
    if (forgot) forgot.onclick = async e => {
      e.preventDefault();
      const email = el.querySelector('#sk-email').value.trim();
      if (!email) { msg('Vul eerst je e-mailadres in.'); return; }
      try { await auth.sendPasswordResetEmail(email); loginForm('login', 'Je krijgt een e-mail om een nieuw wachtwoord te kiezen.'); }
      catch (x) { msg(MSG[x.code] || 'Dat lukte niet. Probeer opnieuw.'); }
    };
    el.querySelector('#sk-form').onsubmit = async e => {
      e.preventDefault();
      const email = el.querySelector('#sk-email').value.trim(), pass = el.querySelector('#sk-pass').value;
      if (create && pass !== el.querySelector('#sk-pass2').value) { msg('De twee wachtwoorden zijn niet gelijk.'); return; }
      const go = el.querySelector('#sk-go'); go.disabled = true; go.textContent = create ? 'Bezig met aanmaken…' : 'Bezig met inloggen…';
      try {
        if (create) await auth.createUserWithEmailAndPassword(email, pass);
        else await auth.signInWithEmailAndPassword(email, pass);
      } catch (x) {
        go.disabled = false; go.textContent = create ? 'Account aanmaken' : 'Inloggen';
        msg(MSG[x.code] || `Dat lukte niet (${x.code || x.message}).`);
      }
    };
  }

  // Dit script staat in <head>; zonder ingelogde gebruiker antwoordt Firebase soms al voor <body> bestaat.
  const domReady = () => document.body ? Promise.resolve()
    : new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));

  // Wacht tot er iemand ingelogd is; toont zo nodig het inlogscherm.
  function signedIn() {
    return new Promise(resolve => {
      let shown = false;
      const off = auth.onAuthStateChanged(u => {
        if (u) { off(); resolve(u); return; }
        if (!shown) { shown = true; domReady().then(() => { if (!auth.currentUser) loginForm('login'); }); }
      });
    });
  }

  /* ---------- gegevens ---------- */
  const base = uid => `data/users/${uid}/`;
  const toCloud = (uid, p, pre = LOCAL_PREFIX) => (p.startsWith(pre) ? base(uid) + p.slice(pre.length) : p);
  const toLocal = (uid, p) => (p.startsWith(base(uid)) ? LOCAL_PREFIX + p.slice(base(uid).length) : p);
  const clean = d => JSON.parse(JSON.stringify(d)); // Firestore weigert undefined
  const mapErr = e => err(String(e && e.code || 'upstream_error').replace(/-/g, '_'), e && e.message);

  // Dezelfde vorm als de opslag in claude.ai, zodat de app niets anders hoeft te weten.
  // mirror(cloudPad, data|null): optionele kopie op deze computer (de desktopapp bewaart alles ook lokaal).
  function dbApi(mirror) {
    const snapDocs = (s, col) => s.docs.map(d => ({ id: d.id, exists: true, data: () => d.data() }));
    const api = {
      collection(col) {
        return {
          onSnapshot(next, onErr) {
            return db.collection(col).onSnapshot({ includeMetadataChanges: false }, s => {
              if (mirror) s.docChanges().forEach(ch => mirror(col + '/' + ch.doc.id, ch.type === 'removed' ? null : ch.doc.data()));
              next({ docs: snapDocs(s, col) });
            }, e => onErr && onErr(mapErr(e)));
          },
          async get() { try { return { docs: snapDocs(await db.collection(col).get(), col) }; } catch (e) { throw mapErr(e); } },
          doc(id) { return api.doc(col + '/' + id); },
        };
      },
      doc(p) {
        return {
          async get() { try { const s = await db.doc(p).get(); return { id: s.id, exists: s.exists, data: () => s.data() }; } catch (e) { throw mapErr(e); } },
          async set(d) {
            const v = clean(d);
            const w = db.doc(p).set(v).catch(e => { throw mapErr(e); });
            w.catch(() => {});
            if (mirror) mirror(p, v);
            // Offline lost een schrijfactie pas op na verbinding; de lokale cache heeft ze al, dus niet wachten.
            await Promise.race([w, new Promise(r => setTimeout(r, 1500))]);
          },
          async delete() { const w = db.doc(p).delete().catch(e => { throw mapErr(e); }); w.catch(() => {}); if (mirror) mirror(p, null); await Promise.race([w, new Promise(r => setTimeout(r, 1500))]); },
        };
      },
    };
    return api;
  }

  /* ---------- afbeeldingen ---------- */
  // Afbeeldingen staan als base64 in Firestore (gratis, zonder betaalde opslag). Een document mag ±1 MB zijn.
  const toB64 = bytes => { let s = ''; const b = new Uint8Array(bytes); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = b64 => { const s = atob(b64), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
  // Alles wat naar het account gaat (nieuwe afbeeldingen, de eerste keer inloggen, een back-up importeren)
  // wordt eerst verkleind: de gratis opslag is 1 GB voor alle accounts samen. GIF blijft zoals het is (animatie).
  const CLOUD_MAX_PX = 1600, CLOUD_OK = 200000, CLOUD_TARGET = 300000;
  async function fitForCloud(bytes, type) {
    if (type === 'image/gif' || bytes.byteLength <= CLOUD_OK || typeof createImageBitmap !== 'function') return { bytes, type };
    let bmp;
    try {
      bmp = await createImageBitmap(new Blob([bytes], { type }));
      let max = CLOUD_MAX_PX, q = 0.84, best = null;
      for (let i = 0; i < 4; i++) {
        const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const g = cv.getContext('2d'); g.drawImage(bmp, 0, 0, w, h);
        let blob = await new Promise(r => cv.toBlob(r, 'image/webp', q));
        if (!blob || blob.type !== 'image/webp') { // oudere browsers: JPEG op een witte achtergrond
          g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
          blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
        }
        if (!blob) break;
        const out = { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
        if (!best || out.bytes.byteLength < best.bytes.byteLength) best = out;
        if (out.bytes.byteLength <= CLOUD_TARGET) break;
        max = Math.round(max * 0.75); q = Math.max(0.62, q - 0.07);
      }
      return best && best.bytes.byteLength < bytes.byteLength ? best : { bytes, type };
    } catch (e) { return { bytes, type }; }
    finally { if (bmp && bmp.close) bmp.close(); }
  }
  // Geeft terug wat er echt in het account staat (mogelijk kleiner dan wat binnenkwam).
  async function assetPut(uid, id, bytes, type) {
    ({ bytes, type } = await fitForCloud(bytes, type));
    if (bytes.byteLength > 740000) throw err('too_large', 'Deze afbeelding is te groot om te synchroniseren.');
    await db.doc(`${base(uid)}library/assets/${id}`).set({ type, size: bytes.byteLength, data: toB64(bytes), created: Date.now() });
    // Grootte apart bijhouden, zodat de opslagmeter de afbeeldingen niet hoeft te downloaden.
    db.doc(`${base(uid)}library`).set({ assetSizes: { [id]: bytes.byteLength } }, { merge: true }).catch(() => {});
    return { bytes, type };
  }
  async function assetGet(uid, id) {
    const s = await db.doc(`${base(uid)}library/assets/${id}`).get();
    if (!s.exists) return null;
    const d = s.data(); return { type: d.type, bytes: fromB64(d.data) };
  }
  const assetDel = (uid, id) => {
    db.doc(`${base(uid)}library`).update({ ['assetSizes.' + id]: firebase.firestore.FieldValue.delete() }).catch(() => {});
    return db.doc(`${base(uid)}library/assets/${id}`).delete().catch(() => {});
  };

  /* ---------- opslagmeter ---------- */
  // Het gratis Spark-abonnement geeft 1 GiB opslag voor de hele database (alle accounts samen, indexen inbegrepen).
  // Elke app meet zijn eigen account en zet alleen de getallen in data/usage/accounts/<uid>.
  // Wie dat overzicht mag lezen, staat in de beveiligingsregels (zie FIREBASE.md); de app toont het alleen als dat lukt.
  const KINDS = ['chapters', 'characters', 'places', 'notes', 'sessions', 'research', 'designs']; // zoals KINDS in schrijfkamer.html
  const USAGE = 'data/usage/accounts', MEASURED = 'schrijfkamer:usage-measured', LIMIT = 1024 ** 3;
  const utf8 = s => new TextEncoder().encode(s).length;
  const isTs = v => v instanceof firebase.firestore.Timestamp;
  const valSize = v => v == null || typeof v === 'boolean' ? 1 : typeof v === 'string' ? utf8(v) + 1
    : typeof v === 'number' || isTs(v) ? 8 : Array.isArray(v) ? v.reduce((a, x) => a + valSize(x), 0)
    : typeof v === 'object' ? Object.entries(v).reduce((a, [k, x]) => a + utf8(k) + 1 + valSize(x), 0) : 8;
  // Schatting volgens de rekenregels van Firestore: document + per veld twee indexregels (oplopend en aflopend).
  function docBytes(path, data) {
    const name = path.split('/').reduce((a, s) => a + utf8(s) + 1, 0) + 16;
    let size = name + 32;
    const walk = (obj, pre) => {
      for (const [k, v] of Object.entries(obj)) {
        const fp = pre ? pre + '.' + k : k, vs = valSize(v);
        if (!pre) size += utf8(k) + 1 + vs;
        size += 2 * (name + utf8(fp) + 1 + Math.min(vs, 1500) + 32);
        if (v && typeof v === 'object' && !Array.isArray(v) && !isTs(v)) walk(v, fp);
      }
    };
    walk(data || {}, '');
    return size;
  }
  async function measure(uid) {
    const root = base(uid) + 'library';
    let bytes = 0, docs = 0, images = 0, imageBytes = 0;
    const add = (p, d) => { bytes += docBytes(p, d); docs++; };
    const one = async p => { const s = await db.doc(p).get(); if (!s.exists) return null; add(p, s.data()); return s.data(); };
    const col = async c => { const s = await db.collection(c).get(); s.docs.forEach(d => add(c + '/' + d.id, d.data())); return s.docs; };
    await one(base(uid) + 'settings');
    const lib = await one(root);
    const books = await col(root + '/books');
    await Promise.all([col(root + '/author'), col(root + '/ledger'),
      ...books.map(b => Promise.all(KINDS.map(k => col(`${root}/books/${b.id}/${k}`))))]);
    for (const [id, n] of Object.entries((lib && lib.assetSizes) || {})) {
      const b = docBytes(`${root}/assets/${id}`, { type: 'image/webp', size: 0, created: 0, data: '' }) + Math.ceil(n / 3) * 4 + 3000;
      bytes += b; imageBytes += b; images++; docs++;
    }
    const out = { email: (auth.currentUser && auth.currentUser.email) || '', bytes, docs, images, imageBytes, updated: Date.now() };
    await db.doc(`${USAGE}/${uid}`).set(out);
    try { localStorage.setItem(MEASURED + ':' + uid, String(out.updated)); } catch (e) {}
    return out;
  }
  // Eén keer per halve dag, een minuut na het openen (dan is de eerste synchronisatie voorbij).
  auth.onAuthStateChanged(u => {
    if (!u) return;
    let last = 0; try { last = +localStorage.getItem(MEASURED + ':' + u.uid) || 0; } catch (e) {}
    if (Date.now() - last < 12 * 3600e3) return;
    setTimeout(() => { if (auth.currentUser && auth.currentUser.uid === u.uid) measure(u.uid).catch(e => console.warn('opslagmeter', e)); }, 60000);
  });
  const fmtBytes = n => n >= 1024 ** 2 ? (n / 1024 ** 2).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB';
  const fmtWhen = t => new Date(t).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  // Vult el met de meter, alleen als de regels dit account het overzicht laten lezen.
  async function usageMount(el) {
    if (!el || !auth.currentUser) return;
    let rows;
    try { rows = (await db.collection(USAGE).get()).docs.map(d => Object.assign({ uid: d.id }, d.data())); }
    catch (e) { el.innerHTML = ''; return; }
    const me = auth.currentUser.uid;
    rows.sort((a, b) => (b.uid === me) - (a.uid === me) || (b.bytes || 0) - (a.bytes || 0));
    const total = rows.reduce((a, r) => a + (r.bytes || 0), 0), pct = total / LIMIT * 100;
    const pctTxt = pct < 0.1 ? '< 0,1' : pct.toFixed(1).replace('.', ',');
    el.innerHTML = `<section style="display:grid;gap:10px;border-top:1px solid var(--line);padding-top:14px">
      <p class="subh" style="margin:0">Opslag in Firebase</p>
      <p style="font-size:13.5px;margin:0"><b>${fmtBytes(total)}</b> <span class="muted">van 1 GB gratis opslag (${pctTxt}%). Alleen jij ziet dit.</span></p>
      <div style="height:8px;border-radius:99px;background:var(--line,#362D26);overflow:hidden" role="progressbar" aria-label="Opslag gebruikt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}">
        <div style="height:100%;width:${Math.min(100, Math.max(pct, 0.6))}%;background:${pct > 80 ? 'var(--bad,#e07a6a)' : 'var(--pencil,#C9A45C)'}"></div></div>
      ${rows.length ? `<ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.6">${rows.map(r => `<li>${esc(r.email || 'onbekend account')}${r.uid === me ? ' (jij)' : ''}: <b>${fmtBytes(r.bytes || 0)}</b>${r.images ? `, waarvan ${fmtBytes(r.imageBytes || 0)} in ${r.images} ${r.images === 1 ? 'afbeelding' : 'afbeeldingen'}` : ''} <span class="faint">· gemeten ${fmtWhen(r.updated)}</span></li>`).join('')}</ul>`
        : '<p class="muted" style="font-size:13.5px;margin:0">Nog niets gemeten.</p>'}
      <p class="hint" style="margin:0">Een schatting, met de zoekindexen van Firebase erbij. Elke app meet zijn eigen account één keer per halve dag; een account dat nog niet gemeten is, staat er nog niet bij.</p>
      <div class="row"><button class="btn ghost" type="button" id="sk-usage-now">Mijn account nu meten</button></div></section>`;
    const btn = el.querySelector('#sk-usage-now');
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Bezig met meten…';
      try { await measure(me); await usageMount(el); }
      catch (e) { btn.disabled = false; btn.textContent = 'Meten lukte niet. Opnieuw?'; }
    };
  }

  /* ---------- eerste keer: lokale boeken naar het account, zonder iets te verliezen ---------- */
  // localDocs: pad → data (lokale paden). Regels: wat online nog niet bestaat gaat online;
  // wat identiek is blijft; bij verschil wint de nieuwste ("updated"), anders de online versie.
  // De verliezende versie komt terug in "lost" zodat de aanroeper ze als reservekopie kan bewaren.
  async function migrate(uid, localDocs, assets, readAsset, progress, prefix) {
    const paths = Object.keys(localDocs);
    const byCol = {};
 for (const p of paths) { const c = toCloud(uid, p, prefix || LOCAL_PREFIX); const col = c.slice(0, c.lastIndexOf('/')); (byCol[col] = byCol[col] || []).push([p, c]); }
    const res = { uploaded: 0, same: 0, kept: 0, replaced: 0, lost: {}, assets: 0 };
    let batch = db.batch(), n = 0;
    const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
    const cols = Object.keys(byCol);
    for (let i = 0; i < cols.length; i++) {
      progress && progress(`Je boeken worden online gezet… (${i + 1}/${cols.length})`);
      const snap = await db.collection(cols[i]).get();
      const online = {}; snap.docs.forEach(d => { online[d.id] = d.data(); });
      for (const [lp, cp] of byCol[cols[i]]) {
        const id = cp.slice(cp.lastIndexOf('/') + 1), mine = clean(localDocs[lp]), theirs = online[id];
        if (theirs === undefined) { batch.set(db.doc(cp), mine); n++; res.uploaded++; }
        else if (JSON.stringify(theirs) === JSON.stringify(mine)) res.same++;
        else if ((mine.updated || 0) > (theirs.updated || 0)) { batch.set(db.doc(cp), mine); n++; res.replaced++; res.lost[cp] = theirs; }
        else { res.kept++; res.lost[lp] = mine; }
        if (n >= 400) await flush();
      }
    }
    await flush();
    for (let i = 0; i < assets.length; i++) {
      progress && progress(`Afbeeldingen worden online gezet… (${i + 1}/${assets.length})`);
      const id = assets[i];
      try {
        const s = await db.doc(`${base(uid)}library/assets/${id}`).get();
        if (s.exists) continue;
        const a = await readAsset(id); if (!a) continue;
        await assetPut(uid, id, a.bytes, a.type); res.assets++;
      } catch (e) { /* een te grote afbeelding blijft alleen lokaal */ }
    }
    return res;
  }

  function summary(res, onDone) {
    const lost = Object.keys(res.lost).length;
    const el = showOverlay(`
      <p style="margin:0;font-size:15px;font-weight:600">Je boeken staan nu in je account.</p>
      <ul style="margin:0;padding-left:18px;color:var(--muted,#B4A792);font-size:14px;line-height:1.6">
        <li>${res.uploaded} ${res.uploaded === 1 ? 'onderdeel' : 'onderdelen'} online gezet${res.assets ? `, ${res.assets} afbeelding(en)` : ''}</li>
        ${res.same ? `<li>${res.same} stond(en) al identiek online</li>` : ''}
        ${lost ? `<li>${lost} ${lost === 1 ? 'onderdeel verschilde' : 'onderdelen verschilden'} met wat al online stond: de nieuwste versie is gebruikt, de andere staat in je reservekopieën. Er is niets verloren.</li>` : ''}
      </ul>
      <form id="sk-form" style="display:grid">${button('sk-go', 'Verder', true)}</form>`);
    el.querySelector('#sk-form').onsubmit = e => { e.preventDefault(); onDone(); };
    el.querySelector('#sk-go').focus();
  }

  window.SKCloud = {
    auth, db,
    get user() { return auth.currentUser; },
    signedIn, showOverlay, hideOverlay, summary, migrate, dbApi, usageMount,
    toCloud, toLocal, base,
    assetPut: (id, bytes, type) => assetPut(auth.currentUser.uid, id, bytes, type),
    assetGet: id => assetGet(auth.currentUser.uid, id),
    assetDel: id => assetDel(auth.currentUser.uid, id),
    signOut: async () => { await auth.signOut(); location.reload(); },
  };
})();

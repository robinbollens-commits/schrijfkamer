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
  async function assetPut(uid, id, bytes, type) {
    if (bytes.byteLength > 740000) throw err('too_large', 'Deze afbeelding is te groot om te synchroniseren.');
    await db.doc(`${base(uid)}library/assets/${id}`).set({ type, size: bytes.byteLength, data: toB64(bytes), created: Date.now() });
  }
  async function assetGet(uid, id) {
    const s = await db.doc(`${base(uid)}library/assets/${id}`).get();
    if (!s.exists) return null;
    const d = s.data(); return { type: d.type, bytes: fromB64(d.data) };
  }
  const assetDel = (uid, id) => db.doc(`${base(uid)}library/assets/${id}`).delete().catch(() => {});

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
    signedIn, showOverlay, hideOverlay, summary, migrate, dbApi,
    toCloud, toLocal, base,
    assetPut: (id, bytes, type) => assetPut(auth.currentUser.uid, id, bytes, type),
    assetGet: id => assetGet(auth.currentUser.uid, id),
    assetDel: id => assetDel(auth.currentUser.uid, id),
    signOut: async () => { await auth.signOut(); location.reload(); },
  };
})();

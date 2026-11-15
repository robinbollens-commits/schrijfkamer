/* Schrijfkamer op het web (gsm en browser): biedt window.claude.use(...) aan bovenop je account.
   Zonder account-configuratie werkt de app in deze browser alleen, zoals op claude.ai zonder login. */
(function () {
  'use strict';
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

  /* ---------- Android-app (WebView): brug met de app ---------- */
  // De app bewaart downloads zelf (een gewone download kan niet in een WebView) en werkt zichzelf bij.
  // Vanaf app 1.9.1 staat "SchrijfkamerAndroid/<versie>" in de user-agent en dragen antwoorden een id;
  // een oudere app antwoordt op "bewaren" met een kale "ok"/"error" en kent geen updates.
  const android = window.SchrijfkamerAndroid;
  const appVersion = (navigator.userAgent.match(/SchrijfkamerAndroid\/([\d.]+)/) || [])[1] || null;
  const waiting = new Map(), updSubs = [];
  let seq = 0;
  if (android) android.onmessage = e => {
    let m = null; try { m = JSON.parse(e.data); } catch (x) {}
    if (m && m.type === 'update') { updSubs.forEach(f => { try { f(m.status); } catch (x) {} }); return; }
    const key = m && m.id ? m.id : waiting.keys().next().value;
    const done = waiting.get(key); if (!done) return;
    waiting.delete(key); done(m && m.id ? m : { ok: e.data === 'ok' });
  };
  const ask = (type, extra) => new Promise(resolve => { const id = ++seq; waiting.set(id, resolve); android.postMessage(JSON.stringify(Object.assign({ type, id }, extra))); });
  if (android && appVersion) {
    // Zelfde vorm als window.desktop.update, zodat de app dezelfde updateknoppen toont.
    window.SKAppUpdate = {
      version: appVersion,
      state: () => ask('update-state').then(r => r.status),
      check: () => ask('update-check').then(r => r.status),
      install: () => ask('update-install').then(r => r.status),
      onStatus: f => { updSubs.push(f); },
    };
    // Zelf zoeken naar een nieuwe app-versie, hoogstens om de 6 uur.
    addEventListener('load', () => setTimeout(() => {
      const K = 'schrijfkamer:app-update-checked';
      let last = 0; try { last = +localStorage.getItem(K) || 0; } catch (x) {}
      if (Date.now() - last < 6 * 3600e3) return;
      try { localStorage.setItem(K, String(Date.now())); } catch (x) {}
      window.SKAppUpdate.check().catch(() => {});
    }, 4000));
  }
  window.SKAppOld = !!(android && !appVersion); // app van vóór 1.9.1: eenmalig zelf de nieuwe APK installeren
  const toB64 = async blob => { const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/octet-stream' });
      if (android) {
        const r = await ask('save', { filename: filename || 'schrijfkamer.txt', mime: blob.type || 'application/octet-stream', data: await toB64(blob) });
        if (!r.ok) throw err('save_failed', 'Bewaren lukte niet.');
        return { saved: true };
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename || 'schrijfkamer.txt';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return { saved: true };
    },
  };
  const C = window.SKCloud;
  if (!C) { window.claude = { use: async n => { if (n === 'downloads') return downloads; throw err('not_declared'); } }; return; }

  /* ---------- afbeeldingen: in je account, en hier in een cache voor offline ---------- */
  const urls = new Map();
  const cachePut = async (id, bytes, type) => {
    const blob = new Blob([bytes], { type }); urls.set(id, URL.createObjectURL(blob));
    try { await (await caches.open('sk-blobs')).put(id, new Response(blob, { headers: { 'content-type': type } })); } catch (e) {}
  };
  const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const tried = new Set();
  document.addEventListener('error', async e => {
    const img = e.target; if (!img || img.tagName !== 'IMG') return;
    const m = String(img.getAttribute('src') || '').match(/_blob\/([0-9a-f]{32})/); if (!m) return;
    const id = m[1];
    if (urls.has(id)) { img.src = urls.get(id); return; }
    if (tried.has(id)) return; tried.add(id);
    try {
      await cloudReady;
      const a = await C.assetGet(id); if (!a) return;
      await cachePut(id, a.bytes, a.type);
      document.querySelectorAll(`img[src*="${id}"]`).forEach(i => { i.src = urls.get(id); });
    } catch (x) { console.warn(x); }
  }, true);

  /* ---------- inloggen; eerste keer: wat in deze browser stond, gaat mee naar je account ---------- */
  const caps = { downloads };
  const cloudReady = (async () => {
    const u = await C.signedIn();
    const OWNER = 'schrijfkamer:cloud-owner', KEY = 'schrijfkamer:data:v1';
    let owner = null, local = {}; try { owner = localStorage.getItem(OWNER); local = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
    if (!owner && Object.keys(local).length) {
      const say = t => C.showOverlay(`<p style="margin:0;font-size:15px">${t}</p>`);
      try {
        try { localStorage.setItem('schrijfkamer:voor-account', JSON.stringify(local)); } catch (e) {}
        const res = await C.migrate(u.uid, local, [], async () => null, say, 'local/');
        await new Promise(r => C.summary(res, r));
      } catch (e) {
        C.showOverlay(`<p style="margin:0">Online zetten lukte niet (${String(e && (e.code || e.message) || e)}). Je gegevens staan nog in deze browser.</p>
          <form onsubmit="location.reload();return false"><button style="font:inherit;font-weight:600;padding:10px 14px;border-radius:9px;border:0;background:var(--pencil,#C9A45C);color:var(--on-pencil,#1A140D)">Opnieuw proberen</button></form>`);
        return new Promise(() => {});
      }
    }
    try { localStorage.setItem(OWNER, u.uid); } catch (e) {}
    C.hideOverlay();
    caps.db = C.dbApi(null);
    caps.user = { id: async () => u.uid, name: async () => u.email || '' };
    caps.assets = {
      async upload(blob) {
        const id = hex(), bytes = new Uint8Array(await blob.arrayBuffer()), type = blob.type || 'image/webp';
        const s = await C.assetPut(id, bytes, type); await cachePut(id, s.bytes, s.type);
        return { id, url: '_blob/' + id, type: s.type, size: s.bytes.byteLength };
      },
      async delete(id) { await C.assetDel(id); try { (await caches.open('sk-blobs')).delete(id); } catch (e) {} },
    };
    return u;
  })();
  window.claude = { use: async name => {
    if (name === 'downloads') return downloads;
    await cloudReady;
    if (!(name in caps)) throw err('not_declared');
    return caps[name];
  } };
})();

/* Schrijfkamer op het web (gsm en browser): biedt window.claude.use(...) aan bovenop je account.
   Zonder account-configuratie werkt de app in deze browser alleen, zoals op claude.ai zonder login. */
(function () {
  'use strict';
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/octet-stream' });
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
        await C.assetPut(id, bytes, type); await cachePut(id, bytes, type);
        return { id, url: '_blob/' + id, type, size: bytes.byteLength };
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

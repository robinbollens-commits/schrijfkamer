/* Schrijfkamer desktop: biedt window.claude.use(...) aan bovenop de desktopbrug,
   zodat dezelfde app als op claude.ai hier ongewijzigd draait. */
(function () {
  'use strict';
  const D = window.desktop;
  if (!D) return;
  // Wordt een script geweigerd, toon dat dan in plaats van eeuwig te laden.
  document.addEventListener('securitypolicyviolation', e => {
    if (e.effectiveDirective && !e.effectiveDirective.startsWith('script')) return;
    document.body.innerHTML = '<p style="font:16px system-ui;color:#ECE3D2;padding:40px;max-width:560px">Schrijfkamer kon niet starten (' + e.effectiveDirective + '). Je gegevens zijn veilig. Installeer de nieuwste versie of meld dit.</p>';
  });
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const parent = p => p.slice(0, p.lastIndexOf('/'));

  /* ---------- db ---------- */
  let docs = null;
  const ready = D.store.load().then(d => { docs = d || {}; });
  const subs = new Map();
  const rows = col => Object.keys(docs).filter(p => parent(p) === col).map(p => {
    const data = docs[p];
    return { id: p.slice(col.length + 1), exists: true, data: () => clone(data) };
  });
  const notify = col => (subs.get(col) || new Set()).forEach(fn => { try { fn({ docs: rows(col) }); } catch (e) { console.error(e); } });
  const db = {
    collection(col) {
      return {
        onSnapshot(next) {
          if (!subs.has(col)) subs.set(col, new Set());
          subs.get(col).add(next);
          ready.then(() => { if (subs.get(col).has(next)) next({ docs: rows(col) }); });
          return () => subs.get(col).delete(next);
        },
        async get() { await ready; return { docs: rows(col) }; },
        doc(id) { return db.doc(col + '/' + id); },
      };
    },
    doc(p) {
      return {
        async get() { await ready; const has = Object.prototype.hasOwnProperty.call(docs, p); return { id: p.slice(p.lastIndexOf('/') + 1), exists: has, data: () => clone(docs[p]) }; },
        async set(d) { await ready; const v = clone(d); docs[p] = v; await D.store.set(p, v); notify(parent(p)); },
        async delete() { await ready; delete docs[p]; await D.store.del(p); notify(parent(p)); },
      };
    },
  };

  /* ---------- gebruiker ---------- */
  const user = { id: async () => 'desktop', name: async () => '' };

  /* ---------- bestanden ---------- */
  const downloads = {
    async save({ filename, data }) {
      let payload = data;
      if (data instanceof Blob) payload = new Uint8Array(await data.arrayBuffer());
      const r = await D.files.save(filename, payload);
      if (!r || !r.saved) throw err('declined', 'Opslaan geannuleerd');
      return r;
    },
  };

  /* ---------- afbeeldingen ---------- */
  const assets = {
    async upload(blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      try { return await D.assets.save(bytes, blob.type || 'image/webp'); }
      catch (e) { throw err(/unsupported_type/.test(e.message) ? 'unsupported_type' : 'upload_failed', e.message); }
    },
    async delete(id) { await D.assets.del(id); },
  };

  /* ---------- AI ---------- */
  const calls = new Map();
  D.ai.onEvent(m => {
    const c = calls.get(m.id); if (!c) return;
    if (m.type === 'text') { c.text += m.delta || ''; if (c.onText) { try { c.onText({ text: c.text, delta: m.delta || '' }); } catch (e) { console.error(e); } } }
    else if (m.type === 'done') { calls.delete(m.id); c.resolve(m.text != null ? m.text : c.text); }
    else if (m.type === 'error') { calls.delete(m.id); c.reject(err(m.code || 'upstream_error', m.message)); }
  });
  function ask(prompt, opts, json) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      if (opts.signal && opts.signal.aborted) return reject(err('cancelled'));
      calls.set(id, { text: '', onText: opts.onText, resolve, reject });
      if (opts.signal) opts.signal.addEventListener('abort', () => { if (calls.has(id)) { calls.delete(id); D.ai.cancel(id); reject(err('cancelled')); } }, { once: true });
      D.ai.run(id, { prompt: String(prompt), json: !!json }).catch(e => { calls.delete(id); reject(err('upstream_error', e.message)); });
    });
  }
  // Lokale modellen zetten JSON soms in een codeblok of met tekst eromheen.
  function parseLoose(text) {
    const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    try { return JSON.parse(t); } catch (e) {}
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) { try { return JSON.parse(fence[1]); } catch (e) {} }
    const i = t.search(/[[{]/);
    if (i >= 0) {
      const open = t[i], close = open === '{' ? '}' : ']', j = t.lastIndexOf(close);
      if (j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch (e) {} }
    }
    throw err('invalid_json', 'Het antwoord was geen bruikbare JSON.');
  }
  const sample = async (prompt, opts) => ({ text: await ask(prompt, opts, false) });
  sample.json = async (prompt, opts) => {
    const instr = '\n\nAntwoord uitsluitend met geldige JSON, zonder uitleg of codeblok eromheen.';
    try { return parseLoose(await ask(prompt + instr, opts, true)); }
    catch (e) {
      if (e.code !== 'invalid_json') throw e;
      return parseLoose(await ask(prompt + instr, opts, true)); // één nieuwe poging
    }
  };

  const caps = { db, user, downloads, assets, sample };
  window.claude = { use: async name => { if (!(name in caps)) throw err('not_declared'); if (name === 'db') await ready; return caps[name]; } };

  /* ---------- netjes afsluiten ---------- */
  window.__skFlush = async () => {
    try { if (typeof flushAll === 'function') flushAll(); } catch (e) {}
    const t0 = Date.now();
    for (;;) {
      let open = 0;
      try { open = pending.size + busy.size; } catch (e) { open = 0; } // eslint-disable-line no-undef
      if (!open || Date.now() - t0 > 3500) break;
      await new Promise(r => setTimeout(r, 50));
    }
    await D.store.flush();
    return true;
  };
})();

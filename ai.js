'use strict';
// AI-aanbieders voor de desktopapp: Claude (API-sleutel), Ollama en OpenAI-compatibele lokale servers (LM Studio).
const Anthropic = require('@anthropic-ai/sdk').default;

const running = new Map();
const fail = (code, message) => Object.assign(new Error(message || code), { code });
const trimUrl = u => String(u || '').trim().replace(/\/+$/, '');
const estTokens = text => Math.ceil(String(text).length / 3);
// Haiku krijgt geen fallbacks of effort; de andere modellen wel.
const isHaiku = m => /haiku/.test(m);

function netCode(e) {
  if (e && (e.name === 'AbortError' || e.code === 'cancelled')) return 'cancelled';
  const c = e && (e.cause && e.cause.code || e.code);
  if (['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EHOSTUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(c) || (e instanceof TypeError && /fetch failed/i.test(e.message))) return 'offline';
  return e && e.code || 'upstream_error';
}

/* ---------- Claude ---------- */
function claudeClient(cfg) {
  if (!cfg.apiKey) throw fail('not_configured', 'Er is nog geen API-sleutel ingevuld.');
  return new Anthropic({ apiKey: cfg.apiKey, maxRetries: 2 });
}
function claudeCode(e) {
  if (e instanceof Anthropic.APIUserAbortError) return 'cancelled';
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'auth';
  if (e instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (e instanceof Anthropic.NotFoundError) return 'model_missing';
  if (e instanceof Anthropic.APIConnectionError) return 'offline';
  if (e instanceof Anthropic.BadRequestError && /prompt is too long|too many tokens/i.test(e.message)) return 'prompt_too_large';
  return e && e.code || 'upstream_error';
}
function claudeParams(cfg, prompt, maxTokens) {
  const model = cfg.model || 'claude-opus-5-5';
  const p = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
  if (!isHaiku(model)) Object.assign(p, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'medium' } });
  return p;
}
async function claudeRun(cfg, prompt, signal, onText) {
  const client = claudeClient(cfg);
  try {
    const stream = client.beta.messages.stream(claudeParams(cfg, prompt, 16000), { signal });
    stream.on('text', d => onText(d));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw fail('refused');
    return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  } catch (e) { if (e && e.code === 'refused') throw e; throw fail(claudeCode(e), e && e.message); }
}

/* ---------- Ollama ---------- */
async function readLines(res, signal, onLine) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    if (signal.aborted) throw fail('cancelled');
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onLine(line); }
  }
  if (buf.trim()) onLine(buf.trim());
}
async function httpError(res, fallback) {
  let body = ''; try { body = await res.text(); } catch (e) {}
  let msg = body; try { const j = JSON.parse(body); msg = j.error && (j.error.message || j.error) || body; } catch (e) {}
  if (res.status === 404 || /model.*not found|not found.*model|no models? loaded/i.test(msg)) return fail('model_missing', String(msg));
  if (res.status === 401 || res.status === 403) return fail('auth', String(msg));
  return fail(fallback || 'upstream_error', `${res.status} ${String(msg).slice(0, 300)}`);
}
function ollamaCtx(cfg, prompt) {
  const set = Number(cfg.numCtx) || 16384, need = estTokens(prompt) + 4096;
  if (need <= set) return set;
  // Een iets groter venster mag automatisch; daarboven moet je het zelf hoger zetten.
  if (need > Math.max(set, 32768)) throw fail('ctx_too_small');
  return Math.ceil(need / 4096) * 4096;
}
async function ollamaRun(cfg, prompt, signal, onText, json) {
  if (!cfg.ollamaModel) throw fail('not_configured', 'Kies eerst een Ollama-model.');
  const body = { model: cfg.ollamaModel, messages: [{ role: 'user', content: prompt }], stream: true, options: { num_ctx: ollamaCtx(cfg, prompt) } };
  if (json) body.format = 'json';
  let res;
  try { res = await fetch(trimUrl(cfg.ollamaUrl) + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }); }
  catch (e) { throw fail(netCode(e), e.message); }
  if (!res.ok) throw await httpError(res);
  let text = '', err = null;
  try {
    await readLines(res, signal, line => {
      let j; try { j = JSON.parse(line); } catch (e) { return; }
      if (j.error) { err = j.error; return; }
      const d = j.message && j.message.content;
      if (d) { text += d; onText(d); } else if (j.message && j.message.thinking) onText('');
    });
  } catch (e) { throw fail(netCode(e), e.message); }
  if (err) throw fail(/not found/i.test(err) ? 'model_missing' : 'upstream_error', err);
  return text;
}

/* ---------- OpenAI-compatibel (LM Studio, llama.cpp, Jan …) ---------- */
function oaiHeaders(cfg) { const h = { 'content-type': 'application/json' }; if (cfg.oaiKey) h.authorization = 'Bearer ' + cfg.oaiKey; return h; }
async function oaiRun(cfg, prompt, signal, onText) {
  if (!cfg.oaiModel) throw fail('not_configured', 'Kies eerst een model.');
  let res;
  try {
    res = await fetch(trimUrl(cfg.oaiUrl) + '/chat/completions', { method: 'POST', headers: oaiHeaders(cfg), signal,
      body: JSON.stringify({ model: cfg.oaiModel, messages: [{ role: 'user', content: prompt }], stream: true }) });
  } catch (e) { throw fail(netCode(e), e.message); }
  if (!res.ok) throw await httpError(res);
  let text = '';
  try {
    await readLines(res, signal, line => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim(); if (data === '[DONE]') return;
      let j; try { j = JSON.parse(data); } catch (e) { return; }
      const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
      if (d) { text += d; onText(d); }
    });
  } catch (e) { throw fail(netCode(e), e.message); }
  return text;
}

/* ---------- publieke functies ---------- */
async function models(cfg) {
  try {
    if (cfg.provider === 'ollama') {
      const r = await fetch(trimUrl(cfg.ollamaUrl) + '/api/tags', { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return { ok: false, models: [], message: `Ollama antwoordde met ${r.status}.` };
      const j = await r.json(); return { ok: true, models: (j.models || []).map(m => m.name).sort() };
    }
    if (cfg.provider === 'openai') {
      const r = await fetch(trimUrl(cfg.oaiUrl) + '/models', { headers: oaiHeaders(cfg), signal: AbortSignal.timeout(5000) });
      if (!r.ok) return { ok: false, models: [], message: `De server antwoordde met ${r.status}.` };
      const j = await r.json(); return { ok: true, models: (j.data || []).map(m => m.id).sort() };
    }
    return { ok: true, models: [] };
  } catch (e) {
    return { ok: false, models: [], message: 'De server is niet bereikbaar. Draait hij, en klopt het adres?' };
  }
}

const TEST_MSG = {
  auth: 'De sleutel wordt geweigerd. Controleer of je hem volledig hebt geplakt.',
  rate_limited: 'De sleutel werkt, maar je zit aan je limiet of je tegoed is op.',
  model_missing: 'Dat model bestaat niet of is niet geïnstalleerd.',
  offline: 'Geen verbinding. Draait de server, en klopt het adres?',
  not_configured: 'Vul eerst alle velden in.',
};
async function test(cfg) {
  try {
    if (cfg.provider === 'claude') {
      const client = claudeClient(cfg);
      const p = claudeParams(cfg, 'Antwoord met het woord OK.', 64);
      const msg = await client.beta.messages.create(p, { timeout: 30000 });
      return { ok: true, message: `Verbonden met ${msg.model}.` };
    }
    if (cfg.provider === 'ollama' || cfg.provider === 'openai') {
      const m = await models(cfg);
      if (!m.ok) return m;
      const want = cfg.provider === 'ollama' ? cfg.ollamaModel : cfg.oaiModel;
      if (!want) return { ok: false, message: `Verbonden. Kies nu een model (${m.models.length} gevonden).` };
      const has = m.models.some(x => x === want || x === want + ':latest' || x.replace(/:latest$/, '') === want);
      if (!has && cfg.provider === 'ollama') return { ok: false, message: `Verbonden, maar ${want} is niet geïnstalleerd. Typ in een terminal: ollama pull ${want}` };
      return { ok: true, message: has ? `Verbonden. ${want} staat klaar.` : 'Verbonden.' };
    }
    return { ok: false, message: 'Er is geen AI gekozen.' };
  } catch (e) {
    const code = cfg.provider === 'claude' ? claudeCode(e) : netCode(e);
    return { ok: false, message: TEST_MSG[e.code || code] || TEST_MSG[code] || `Dat lukte niet: ${String(e.message || e).slice(0, 200)}` };
  }
}

function run(id, cfg, req, send) {
  const ctl = new AbortController(); running.set(id, ctl);
  const onText = d => send({ type: 'text', delta: d });
  const prompt = String(req && req.prompt || '');
  (async () => {
    if (cfg.provider === 'claude') return claudeRun(cfg, prompt, ctl.signal, onText);
    if (cfg.provider === 'ollama') return ollamaRun(cfg, prompt, ctl.signal, onText, !!req.json);
    if (cfg.provider === 'openai') return oaiRun(cfg, prompt, ctl.signal, onText);
    throw fail('not_configured');
  })()
    .then(text => send({ type: 'done', text }))
    .catch(e => send({ type: 'error', code: ctl.signal.aborted ? 'cancelled' : (e && e.code) || 'upstream_error', message: String(e && e.message || e) }))
    .finally(() => running.delete(id));
}
function cancel(id) { const c = running.get(id); if (c) c.abort(); }

module.exports = { run, cancel, test, models };

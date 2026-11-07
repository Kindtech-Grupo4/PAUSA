// Cliente del motor local (Python en 127.0.0.1). Si no responde, se usan reglas locales.
import { fallback } from './library.js';

let online = false;

async function call(path, body, ms = 3000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    online = true;
    return await r.json();
  } catch (e) {
    online = false;
    throw e;
  } finally { clearTimeout(t); }
}

export const api = {
  get online() { return online; },
  async health() { try { return await call('/api/salud', null, 2000); } catch { return { ok: false }; } },
  async analyze(nota, ai) {
    if (!ai) return fallback.analyze(nota, false); // sin IA: solo filtro de privacidad y señales de riesgo
    try { return await call('/api/analizar', { nota }); } catch { return fallback.analyze(nota, true); }
  },
  async recommend(params, ai) {
    if (!ai) return fallback.recommend(params, false);
    try { return (await call('/api/recomendar', params)).alternatives; } catch { return fallback.recommend(params, true); }
  },
  async patterns(records, ai) {
    if (!ai) return fallback.patterns(records, false);
    try { return await call('/api/patrones', { records, ai }, 15000); } catch { return fallback.patterns(records, true); }
  },
  async contribute(payload) { try { await call('/api/aportar', payload); return true; } catch { return false; } },
};

// Bóveda local cifrada (AES-GCM 256, WebCrypto). Nada sale del dispositivo.
// Con PIN: clave derivada con PBKDF2 (210k iteraciones) y nunca almacenada.
// Sin PIN: clave aleatoria local (cifrado en reposo; el PIN añade protección real).
const META = 'pausa.meta.v1';
const VAULT = 'pausa.vault.v1';
const TTL = 90 * 864e5; // borrado automático tras 90 días sin uso
const enc = new TextEncoder();
const dec = new TextDecoder();

const DEFAULTS = { ai: true, sensors: true, sound: true, voice: true, contribute: false, reducedMotion: false, largeText: false };

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const randHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

async function derive(pin, saltB64) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: 210000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const importRaw = (rawB64) => crypto.subtle.importKey('raw', unb64(rawB64), 'AES-GCM', false, ['encrypt', 'decrypt']);

let meta = null;
let key = null;
let cache = null;

function saveMeta() { localStorage.setItem(META, JSON.stringify(meta)); }
function touch() { meta.lastUsed = Date.now(); saveMeta(); }

async function writeVault() {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(cache))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  localStorage.setItem(VAULT, b64(out));
}

async function readVault() {
  const v = localStorage.getItem(VAULT);
  if (!v) { cache = { records: [] }; return; }
  const raw = unb64(v);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12));
  cache = JSON.parse(dec.decode(pt));
}

async function setKeyFromPin(pin) {
  if (pin) {
    meta.salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    meta.hasPin = true;
    delete meta.rawKey;
    key = await derive(pin, meta.salt);
  } else {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    meta.rawKey = b64(raw);
    meta.hasPin = false;
    delete meta.salt;
    key = await importRaw(meta.rawKey);
  }
}

export const store = {
  async load() {
    try { meta = JSON.parse(localStorage.getItem(META) || 'null'); } catch { meta = null; }
    if (!meta) return 'new';
    if (Date.now() - (meta.lastUsed || 0) > TTL) { this.wipe(); return 'expired'; }
    meta.settings = { ...DEFAULTS, ...meta.settings };
    if (meta.hasPin) return 'locked';
    key = await importRaw(meta.rawKey);
    await readVault();
    touch();
    return 'ready';
  },

  async create({ ai, sensors, pin }) {
    meta = { id: randHex(8), token: randHex(16), createdAt: Date.now(), lastUsed: Date.now(), settings: { ...DEFAULTS, ai, sensors } };
    await setKeyFromPin(pin || null);
    cache = { records: [] };
    await writeVault();
    saveMeta();
  },

  async unlock(pin) {
    try { key = await derive(pin, meta.salt); await readVault(); touch(); return true; }
    catch { key = null; return false; }
  },

  async setPin(pin) { await setKeyFromPin(pin || null); await writeVault(); saveMeta(); },

  /** Verifica un PIN intentando descifrar la bóveda (el PIN nunca se guarda). */
  async verifyPin(pin) {
    if (!meta?.hasPin) return true;
    if (!/^\d{4,6}$/.test(pin)) return false;
    try {
      const k = await derive(pin, meta.salt);
      const raw = unb64(localStorage.getItem(VAULT));
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, k, raw.subarray(12));
      return true;
    } catch { return false; }
  },

  get id() { return meta?.id; },
  get ready() { return !!cache; },
  get locked() { return !!(meta?.hasPin && !cache); },
  get token() { return meta?.token; },
  get hasPin() { return !!meta?.hasPin; },
  get createdAt() { return meta?.createdAt; },
  setting(k) { return meta?.settings?.[k] ?? DEFAULTS[k]; },
  setSetting(k, v) { meta.settings[k] = v; saveMeta(); },

  records() { return cache ? cache.records.slice() : []; },
  async add(rec) { const r = { id: randHex(6), ...rec }; cache.records.push(r); await writeVault(); touch(); return r; },
  async addMany(recs) { recs.forEach((r) => cache.records.push({ id: randHex(6), ...r })); await writeVault(); },
  async update(id, patch) { const r = cache.records.find((x) => x.id === id); if (r) { Object.assign(r, patch); await writeVault(); } },
  async remove(id) { cache.records = cache.records.filter((x) => x.id !== id); await writeVault(); },
  async removeWhere(fn) { cache.records = cache.records.filter((x) => !fn(x)); await writeVault(); },
  vaultBytes() { return (localStorage.getItem(VAULT) || '').length; },
  vaultPreview() { return (localStorage.getItem(VAULT) || '').slice(0, 42); },

  wipe() { localStorage.removeItem(META); localStorage.removeItem(VAULT); meta = null; key = null; cache = null; },
};

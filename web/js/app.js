import { store } from './store.js';
import { api } from './api.js';
import { TRIGGERS, LIBRARY } from './library.js';
import { Orb } from './orb.js';
import { Guide } from './sound.js';
import { Session } from './session.js';
import { Calculator } from './calculator.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const INTENSITY_LABELS = ['Leve', '', 'Moderado', '', 'Muy fuerte'];
const HELPED = { si: 'Ayudó', algo: 'Un poco', no: 'No ayudó' };

// ---------- utilidades ----------
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }
const franja = (h) => (h <= 5 ? 'madrugada' : h <= 11 ? 'mañana' : h <= 17 ? 'tarde' : 'noche');

function applyPrefs() {
  document.documentElement.classList.toggle('reduce-motion', store.setting('reducedMotion'));
  document.documentElement.classList.toggle('large-text', store.setting('largeText'));
}
const prefs = () => ({ ai: store.setting('ai'), sensors: store.setting('sensors'), sound: store.setting('sound'), voice: store.setting('voice') });

// ---------- transparencia de red: se mide, no se promete ----------
let external = 0;
try {
  new PerformanceObserver((list) => {
    list.getEntries().forEach((e) => { try { if (new URL(e.name).origin !== location.origin) external++; } catch { /* data: */ } });
    const pill = $('net-pill');
    pill.querySelector('b').textContent = `${external} conexiones externas`;
    pill.className = `pill ${external ? 'bad' : 'ok'}`;
  }).observe({ type: 'resource', buffered: true });
} catch { /* navegador antiguo */ }

let engine = { ok: false, llm: false };
async function checkEngine() {
  engine = await api.health();
  const pill = $('engine-pill');
  pill.className = `pill ${engine.ok ? 'ok' : 'warn'}`;
  pill.querySelector('b').textContent = engine.ok ? (engine.llm ? 'Motor local · IA + LLM local' : 'Motor local · IA en el equipo') : 'Modo reglas (motor apagado)';
}

// ---------- navegación ----------
const orbs = {};
let current = null;
function go(name) {
  if (!store.ready && !['onboarding', 'lock', 'support'].includes(name)) {
    name = store.locked ? 'lock' : 'onboarding';
  }
  if (name === 'checkin') resetCheckin();
  if (name !== 'session' && current === 'session') session.kill();
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `s-${name}`));
  const el = $(`s-${name}`);
  $('app').classList.toggle('bare', el.hasAttribute('data-bare') || !store.ready);
  $$('#rail button').forEach((b) => b.classList.toggle('active', b.dataset.go === name || (name === 'checkin' || name === 'choose' || name === 'after') && b.dataset.go === 'home'));
  ['onb', 'home'].forEach((k) => orbs[k]?.[(name === 'onboarding' && k === 'onb') || (name === 'home' && k === 'home') ? 'start' : 'stop']());
  current = name;
  $('view').scrollTop = 0;
  if (name === 'home') renderHome();
  if (name === 'patterns') renderPatterns();
  if (name === 'privacy') renderPrivacy();
  if (name !== 'support') $('crisis-banner').hidden = true;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b && $('calc').hidden) go(b.dataset.go);
});

// ---------- onboarding y bloqueo ----------
function setupOnboarding() {
  const validate = () => {
    const pin = $('onb-pin').value;
    $('onb-start').disabled = !($('onb-adult').checked && (pin === '' || /^\d{4,6}$/.test(pin)));
  };
  ['onb-adult', 'onb-pin'].forEach((id) => $(id).addEventListener('input', validate));
  $('onb-start').onclick = async () => {
    await store.create({ ai: $('onb-ai').checked, sensors: $('onb-sensors').checked, pin: $('onb-pin').value || null });
    $('onb-pin').value = '';
    applyPrefs();
    toast('Listo. Sin cuenta: tu identificador aleatorio vive solo en este equipo.');
    go('home');
  };
  const unlock = async () => {
    const ok = await store.unlock($('lock-pin').value);
    $('lock-error').hidden = ok;
    $('lock-pin').value = '';
    if (ok) { applyPrefs(); go('home'); }
  };
  $('lock-go').onclick = unlock;
  $('lock-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
  $('lock-reset').onclick = () => { if (confirm('Se borrarán todos tus registros de este equipo. ¿Continuar?')) { store.wipe(); go('onboarding'); } };
}

// ---------- inicio ----------
function renderHome() {
  const h = new Date().getHours();
  $('home-greeting').textContent = h < 5 ? 'Es tarde · cuídate' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}
setInterval(() => {
  if (current !== 'home' || !orbs.home) return;
  const ph = ((performance.now() - orbs.home.t0) / 1000) % 10;
  $('home-caption').textContent = ph < 4 ? 'Inhala con la luz' : 'Exhala despacio';
}, 250);

// ---------- 2 · check-in ----------
const ci = { trigger: null, intensity: null, note: '', suggestion: null, aiLabel: null, noteToStore: '' };

function intensityPicker(root, onPick) {
  root.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button role="radio" aria-label="Intensidad ${n} ${INTENSITY_LABELS[n - 1]}" data-v="${n}" style="width:${34 + n * 7}px;height:${34 + n * 7}px">${n}</button>`).join('');
  root.insertAdjacentHTML('afterend', root.nextElementSibling?.classList.contains('intensity-scale') ? '' : '<div class="intensity-scale"><span>Leve</span><span>Muy fuerte</span></div>');
  root.onclick = (e) => { const v = e.target.dataset.v; if (!v) return; $$('button', root).forEach((b) => b.classList.toggle('on', b.dataset.v === v)); onPick(+v); };
}

function resetCheckin() {
  Object.assign(ci, { trigger: null, intensity: null, note: '', suggestion: null, aiLabel: null, noteToStore: '' });
  $$('#trigger-chips button, #intensity button').forEach((b) => b.classList.remove('on'));
  $('note').value = ''; $('note-count').textContent = '0/280'; $('suggestion').hidden = true;
}

function selectTrigger(id) {
  ci.trigger = id;
  $$('#trigger-chips button').forEach((b) => b.classList.toggle('on', b.dataset.v === id));
}

function renderSuggestion(res) {
  const box = $('suggestion');
  if (!res?.label || res.label.id === ci.trigger) { box.hidden = true; return; }
  const l = res.label;
  const conf = l.confidence >= 0.7 ? 'confianza alta' : l.confidence >= 0.5 ? 'confianza media' : 'confianza baja';
  box.innerHTML = `<div class="row between"><span class="tag ai">Asistente con IA · sugerencia</span><span class="muted small">${conf}</span></div>
    <p><b>¿Podría ser «${esc(l.label)}»?</b></p><p class="muted small">${esc(res.reason)}</p>
    <div class="row gap"><button class="btn primary small" data-act="accept">Usar «${esc(l.label)}»</button>
    ${l.alternatives.map((a) => `<button class="btn glass small" data-alt="${a}">${TRIGGERS[a]}</button>`).join('')}
    <button class="btn ghost small" data-act="ignore">Ignorar</button></div>`;
  box.hidden = false;
  box.onclick = (e) => {
    const act = e.target.dataset.act, alt = e.target.dataset.alt;
    if (act === 'accept' || alt) { selectTrigger(alt || l.id); ci.aiLabel = { suggested: l.id, accepted: !alt, corrected: alt || null }; box.hidden = true; }
    if (act === 'ignore') { ci.aiLabel = { suggested: l.id, accepted: false }; ci.suggestion = null; box.hidden = true; }
  };
}

function setupCheckin() {
  $('trigger-chips').innerHTML = Object.entries(TRIGGERS).map(([k, v]) => `<button role="radio" data-v="${k}">${v}</button>`).join('');
  $('trigger-chips').onclick = (e) => { if (e.target.dataset.v) { selectTrigger(e.target.dataset.v); if (ci.suggestion) renderSuggestion(ci.suggestion); } };
  intensityPicker($('intensity'), (v) => { ci.intensity = v; });
  let deb;
  $('note').addEventListener('input', (e) => {
    $('note-count').textContent = `${e.target.value.length}/280`;
    clearTimeout(deb);
    deb = setTimeout(async () => {
      const text = e.target.value.trim();
      if (text.length < 6 || !store.setting('ai')) { $('suggestion').hidden = true; return; }
      ci.suggestion = await api.analyze(text, true);
      if (!ci.suggestion.crisis) renderSuggestion(ci.suggestion);
    }, 550);
  });
  $('checkin-next').onclick = async () => {
    const note = $('note').value.trim();
    ci.noteToStore = '';
    if (note) {
      const res = await api.analyze(note, store.setting('ai'));
      if (res.crisis) { $('note').value = ''; showCrisis(); return; }
      if (res.privacy_notice) toast(res.privacy_notice);
      ci.noteToStore = res.store_note ? res.sanitized_note : '';
    }
    if (!ci.trigger) selectTrigger(ci.suggestion?.label?.id && store.setting('ai') ? ci.suggestion.label.id : 'otro');
    if (!ci.intensity) ci.intensity = 3;
    await renderChoose();
    go('choose');
  };
}

function showCrisis() {
  go('support');
  $('crisis-banner').hidden = false;
}

// ---------- 3 · elegir y vivir la pausa ----------
let minutes = 5;
function historyByAlt() {
  const h = {};
  store.records().forEach((r) => {
    if (!r.alt || !r.helped) return;
    const x = (h[r.alt] ||= { used: 0, helped: 0 });
    x.used++; x.helped += r.helped === 'si' ? 1 : r.helped === 'algo' ? 0.5 : 0;
  });
  Object.values(h).forEach((x) => { x.helped = Math.round(x.helped); });
  return h;
}

async function renderChoose() {
  const now = new Date();
  const ai = store.setting('ai');
  const alts = await api.recommend({ trigger: ci.trigger, intensity: ci.intensity, hour: now.getHours(), history: historyByAlt() }, ai);
  $('choose-sub').innerHTML = ai
    ? `<span class="tag ai">Asistente con IA</span> Ordenadas según «${esc(TRIGGERS[ci.trigger])}», intensidad ${ci.intensity} y la hora (${now.toTimeString().slice(0, 5)}) desde una biblioteca cerrada.`
    : 'Asistente desactivado: orden fijo de la biblioteca.';
  $('alts').innerHTML = alts.map((a, i) => `
    <button class="card alt ${i === 0 ? 'first' : ''}" data-alt="${a.id}" data-phrase="${esc(a.phrase || '')}">
      <div class="row between"><span class="alt-ico">${LIBRARY[a.id].icon}</span>${i === 0 ? '<span class="tag llm">Recomendada</span>' : ''}</div>
      <h3>${esc(a.title)}</h3><p>${esc(a.desc)}</p>
      <div class="meta"><span class="tag">${a.minutes < 1 ? '10 s' : ['breath', 'sleep', 'walk', 'reach'].includes(a.id) ? 'duración elegida' : `${a.minutes} min`}</span>${a.sensor ? `<span class="tag">${esc(a.sensor)}</span>` : ''}</div>
      <p class="why">${ai ? '<b>¿Por qué?</b> ' : ''}${esc(a.why)}</p>
    </button>`).join('');
}

function setupChoose() {
  $('alts').onclick = (e) => { const c = e.target.closest('.alt'); if (c) startSession(c.dataset.alt, c.dataset.phrase); };
  $('duration').onclick = (e) => {
    const m = e.target.dataset.min; if (!m) return;
    minutes = +m; $$('#duration button').forEach((b) => b.classList.toggle('on', b === e.target));
  };
}

const guide = new Guide();
const session = new Session(guide, toast);
let lastRecord = null;

function startSession(mode, phrase) {
  go('session');
  session.begin({
    mode, minutes, phrase, prefs: prefs(),
    onDone: async (res) => {
      const d = new Date();
      lastRecord = store.ready ? await store.add({
        ts: d.getTime(), hour: d.getHours(), weekday: (d.getDay() + 6) % 7,
        trigger: ci.trigger, intensity: ci.intensity, note: ci.noteToStore || undefined, aiLabel: ci.aiLabel || undefined,
        alt: mode, helped: null, after: null, quick: !ci.trigger, ...res,
      }) : null;
      showAfter(res);
    },
  });
}

function showAfter(res) {
  $('after-eyebrow').textContent = res.completed ? 'Pausa completada' : 'Pausa interrumpida';
  $('after-title').textContent = res.completed ? 'Recuperaste un momento para decidir con calma.' : 'Está bien parar cuando lo necesites. Detenerte ya fue una decisión.';
  const bits = [`${Math.floor(res.duration / 60)} min ${res.duration % 60} s`];
  if (res.sensor === 'mic' || res.sensor === 'touch') {
    if (res.cycles) bits.push(`${res.cycles} respiraciones`);
    if (res.rate) bits.push(`ritmo final ${res.rate}/min`);
    if (res.longest) bits.push(`exhalación más larga ${res.longest} s`);
  }
  if (res.sensor === 'camera') bits.push('movimiento medido sin imágenes');
  $('after-stats').textContent = bits.join(' · ');
  $$('#after-intensity button, #after-helped button').forEach((b) => b.classList.remove('on'));
  afterState.after = null; afterState.helped = null;
  go('after');
}

const afterState = { after: null, helped: null };
function setupAfter() {
  intensityPicker($('after-intensity'), (v) => { afterState.after = v; });
  $('after-helped').onclick = (e) => {
    const v = e.target.dataset.v; if (!v) return;
    afterState.helped = v; $$('#after-helped button').forEach((b) => b.classList.toggle('on', b === e.target));
  };
  const commit = async () => {
    if (!lastRecord) return;
    await store.update(lastRecord.id, { after: afterState.after, helped: afterState.helped });
    if (store.setting('contribute') && lastRecord.trigger) {
      api.contribute({ token: store.token, trigger: lastRecord.trigger, franja: franja(lastRecord.hour), helped: afterState.helped });
    }
    lastRecord = null;
  };
  $('after-save').onclick = async () => { await commit(); toast('Guardado y cifrado en tu equipo. Puedes cerrar PAUSA.'); go('home'); };
  $('after-again').onclick = async () => { await commit(); if (ci.trigger) { await renderChoose(); go('choose'); } else go('checkin'); };
}

// ---------- 4 · patrones ----------
async function renderPatterns() {
  const recs = store.records().sort((a, b) => b.ts - a.ts);
  const minimal = recs.map(({ hour, weekday, trigger, intensity, alt, helped, after }) => ({ hour, weekday, trigger: trigger || 'otro', intensity, alt, helped, after }));
  $('demo-clear').hidden = !recs.some((r) => r.demo);
  $('insights').innerHTML = '<p class="muted">Leyendo tus registros en el equipo…</p>';
  const ai = store.setting('ai');
  const p = await api.patterns(minimal, ai);
  let html = `<div class="row between"><span class="tag ai">${ai ? 'Asistente con IA · lectura de patrones' : 'Sin asistente · solo conteos'}</span>${p.llm ? '<span class="tag llm">Redactado por LLM local</span>' : ''}</div><ul>${p.insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  if (p.enough === false && !p.rulesOnly) html += `<div class="progress"><i style="width:${Math.min(100, (p.n / 7) * 100)}%"></i></div>`;
  if (p.autonomy) html += `<p class="small" style="margin-top:12px;color:var(--teal)">🌱 ${esc(p.autonomy)}</p>`;
  if (p.disclaimer) html += `<p class="muted small" style="margin-top:8px">${esc(p.disclaimer)}</p>`;
  $('insights').innerHTML = html;

  const fr = p.counts.franja; const maxF = Math.max(1, ...Object.values(fr));
  $('chart-franja').innerHTML = Object.entries(fr).map(([k, v]) => `<div class="col"><b>${v}</b><i style="height:${(v / maxF) * 120}px"></i><span>${k}</span></div>`).join('');
  const tr = Object.entries(p.counts.trigger).sort((a, b) => b[1] - a[1]); const maxT = Math.max(1, ...tr.map((x) => x[1]));
  $('chart-trigger').innerHTML = tr.length ? tr.map(([k, v]) => `<div class="hrow"><span>${TRIGGERS[k] || k}</span><div class="track2"><i style="width:${(v / maxT) * 100}%"></i></div><b>${v}</b></div>`).join('') : '<p class="empty">Sin datos todavía</p>';

  $('rec-count').textContent = `${recs.length} registros · cifrados · sin rachas ni puntajes`;
  const opts = (sel) => Object.entries(TRIGGERS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
  $('records').innerHTML = recs.length ? recs.map((r) => `
    <div class="rec" data-id="${r.id}">
      <span>${new Date(r.ts).toLocaleString('es-PE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${r.demo ? ' · <span class="tag">demo</span>' : ''}</span>
      <select aria-label="Corregir detonante">${opts(r.trigger || 'otro')}</select>
      <span class="note">${esc(LIBRARY[r.alt]?.title || '')}${r.note ? ` · “${esc(r.note)}”` : ''}</span>
      <span class="muted">${r.intensity ? `${r.intensity}${r.after ? ` → ${r.after}` : ''}` : ''} ${r.helped ? `· ${HELPED[r.helped]}` : ''}</span>
      <button title="Borrar este registro" aria-label="Borrar registro">✕</button>
    </div>`).join('') : '<p class="empty">Tu registro está vacío. Aparecerá aquí tras tu primera pausa.</p>';
}

function setupPatterns() {
  $('records').addEventListener('change', async (e) => {
    const id = e.target.closest('.rec')?.dataset.id;
    if (id) { await store.update(id, { trigger: e.target.value, corrected: true }); toast('Etiqueta corregida'); renderPatterns(); }
  });
  $('records').addEventListener('click', async (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    await store.remove(e.target.closest('.rec').dataset.id); toast('Registro borrado'); renderPatterns();
  });
  $('demo-load').onclick = async () => { await store.addMany(demoRecords()); toast('14 registros de demostración añadidos (marcados como demo)'); renderPatterns(); };
  $('demo-clear').onclick = async () => { await store.removeWhere((r) => r.demo); renderPatterns(); };
}

function demoRecords() {
  const plan = [
    [23, 'estres', 4, 'breath', 'si', 2], [0, 'antes_de_dormir', 3, 'sleep', 'si', 1], [22, 'estres', 5, 'tense', 'algo', 3],
    [16, 'aburrimiento', 2, 'walk', 'si', 1], [1, 'ansiedad', 4, 'breath', 'si', 2], [23, 'soledad', 3, 'reach', 'algo', 2],
    [21, 'estres', 4, 'breath', 'si', 2], [0, 'antes_de_dormir', 4, 'sleep', 'si', 2], [15, 'habito', 3, 'motion', 'algo', 2],
    [23, 'estres', 3, 'tense', 'no', 3], [2, 'ansiedad', 5, 'breath', 'algo', 3], [22, 'soledad', 3, 'reach', 'si', 1],
    [20, 'aburrimiento', 2, 'motion', 'si', 1], [23, 'estres', 4, 'breath', 'si', 1],
  ];
  const now = Date.now();
  return plan.map(([hour, trigger, intensity, alt, helped, after], i) => {
    const d = new Date(now - (plan.length - i) * 1.4 * 864e5); d.setHours(hour, (i * 17) % 60, 0, 0);
    return { ts: d.getTime(), hour, weekday: (d.getDay() + 6) % 7, trigger, intensity, alt, helped, after, completed: true, duration: 180, demo: true };
  });
}

// ---------- privacidad ----------
function renderPrivacy() {
  $$('[data-setting]').forEach((i) => { i.checked = !!store.setting(i.dataset.setting); });
  const exp = new Date(Date.now() + 90 * 864e5).toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' });
  const facts = [
    ['Identificador local aleatorio', store.id],
    ['Cuenta, nombre, correo o código', 'Ninguno'],
    ['Registros cifrados en este equipo', store.records().length],
    ['Cifrado', store.hasPin ? 'AES-GCM 256 · clave PBKDF2 de tu PIN' : 'AES-GCM 256 · clave local (activa PIN)'],
    ['Así se ve tu bóveda', `<code>${esc(store.vaultPreview())}…</code>`],
    ['Audio y video', 'Procesados en memoria · nunca guardados'],
    ['Borrado automático si no vuelves', exp],
    ['Motor de IA', engine.ok ? (engine.llm ? 'Python local + LLM local' : 'Python local (reglas + plantillas)') : 'Reglas en el navegador'],
    ['Conexiones externas en esta sesión', external],
  ];
  $('facts').innerHTML = facts.map(([k, v]) => `<li><span>${k}</span><span>${typeof v === 'string' && v.startsWith('<code>') ? v : esc(v)}</span></li>`).join('');
  $('pin-exit-hint').textContent = store.hasPin ? ' después de escribir tu PIN' : '';
  $('pin-remove').hidden = !store.hasPin;
}

function setupPrivacy() {
  $$('[data-setting]').forEach((i) => i.addEventListener('change', () => {
    store.setSetting(i.dataset.setting, i.checked); applyPrefs();
    if (i.dataset.setting === 'contribute' && i.checked) toast('Solo se aportan 3 campos y solo se muestran con 20+ personas.');
  }));
  $('pin-save').onclick = async () => {
    const pin = $('pin-new').value;
    if (!/^\d{4,6}$/.test(pin)) return toast('El PIN debe tener de 4 a 6 dígitos');
    await store.setPin(pin); $('pin-new').value = ''; toast('PIN guardado. Tus registros se volvieron a cifrar.'); renderPrivacy();
  };
  $('pin-remove').onclick = async () => { await store.setPin(null); toast('PIN eliminado'); renderPrivacy(); };
  $('wipe').onclick = () => {
    if (!confirm('Se borrará todo de este equipo de forma inmediata e irreversible. ¿Continuar?')) return;
    store.wipe(); resetCheckin(); toast('Todo borrado. No queda nada en este equipo.'); go('onboarding');
  };
  $('res-trust').onclick = () => { ci.trigger = ci.trigger || 'soledad'; startSession('reach', ''); };
}

// ---------- modo camaleón ----------
const calc = new Calculator($('calc'), {
  checkPin: (typed) => store.verifyPin(typed),
  onExit: () => {
    $('calc').hidden = true; $('app').inert = false;
    document.title = 'PAUSA · Pausa somática'; $('favicon').href = 'assets/icon.svg';
    go(store.ready ? 'home' : 'onboarding');
  },
});
function chameleon() {
  session.kill(); guide.silence();
  Object.values(orbs).forEach((o) => o.stop());
  $('calc').hidden = false; $('app').inert = true;
  document.title = 'Calculadora'; $('favicon').href = 'assets/calc.svg';
  current = 'calc';
}
let lastEsc = 0;
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !$('calc').hidden) return;
  const now = performance.now();
  if (now - lastEsc < 500 && current !== 'onboarding' && current !== 'lock') chameleon();
  lastEsc = now;
});
$('btn-chameleon').onclick = () => { if (current !== 'onboarding' && current !== 'lock') chameleon(); };

// ---------- arranque ----------
async function boot() {
  orbs.onb = new Orb($('orb-onb'), { auto: true });
  orbs.home = new Orb($('orb-home'), { auto: true });
  setupOnboarding(); setupCheckin(); setupChoose(); setupAfter(); setupPatterns(); setupPrivacy();
  $('btn-quick').onclick = () => { resetCheckin(); startSession('tense'); };
  checkEngine(); setInterval(checkEngine, 15000);
  const state = await store.load();
  if (state === 'ready') { applyPrefs(); go('home'); }
  else if (state === 'locked') { applyPrefs(); go('lock'); setTimeout(() => $('lock-pin').focus(), 50); }
  else { go('onboarding'); if (state === 'expired') toast('Pasaron 90 días sin uso: tus datos se borraron automáticamente.'); }
}
boot();

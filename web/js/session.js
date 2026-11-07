// Controlador de la pausa somática (pantalla 3, valor principal).
import { Orb } from './orb.js';
import { BreathSensor, TouchBreath } from './sensors/breath.js';
import { MotionSensor } from './sensors/motion.js';
import { LIBRARY } from './library.js';

const $ = (id) => document.getElementById(id);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;
const ease = (p) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, p)));

const RHYTHMS = {
  breath: [{ k: 'in', s: 4, cue: 'Inhala', voice: 'Inhala' }, { k: 'out', s: 6, cue: 'Exhala', voice: 'Exhala despacio' }],
  sleep: [{ k: 'in', s: 4, cue: 'Inhala por la nariz', voice: 'Inhala' }, { k: 'hold', s: 7, cue: 'Sostén', voice: 'Sostén' }, { k: 'out', s: 8, cue: 'Exhala lento', voice: 'Exhala lento' }],
};
const MOTION_STEPS = [
  { s: 15, cue: 'Estira los brazos hacia el techo', sub: 'Lento, como si te desperezaras' },
  { s: 15, cue: 'Gira los hombros hacia atrás', sub: 'Cinco giros amplios' },
  { s: 15, cue: 'Sacude manos y brazos', sub: 'Suelta la tensión acumulada' },
  { s: 15, cue: 'Quieto/a. Siente tus manos', sub: 'Nota el pulso y el calor' },
];
const EXTRA_PHRASES = ['Hola, ¿cómo estás? Hace tiempo que no hablamos.', '¿Te provoca una llamada corta? Me vendría bien conversar.',
  '¿Qué tal tu día? Te cuento del mío si quieres.', '¿Salimos a caminar mañana un rato?'];

export class Session {
  constructor(guide, toast) {
    this.guide = guide; this.toast = toast;
    this.orb = new Orb($('orb-session'));
    $('sess-exit').onclick = () => this.finish(false);
    $('sensor-switch').onclick = (e) => { const src = e.target.dataset?.src; if (src && src !== this.sensor?.kind) this.useSensor(src); };
    $('sens').oninput = (e) => { if (this.sensor?.kind === 'mic') this.sensor.sensitivity = +e.target.value; };
    $('sess-sound').onclick = () => {
      const on = !(this.guide.sound || this.guide.voice);
      this.guide.sound = on; this.guide.voice = on && this.prefs.voice;
      if (!on) this.guide.silence();
      $('sess-sound').classList.toggle('off', !on);
    };
    $('reach-copy').onclick = async () => { try { await navigator.clipboard.writeText(this.phrase); this.toast('Frase copiada. Tú decides a quién enviarla.'); } catch { this.toast('No se pudo copiar'); } };
    $('reach-shuffle').onclick = () => { this.phraseIdx = (this.phraseIdx + 1) % this.phrases.length; this.setPhrase(this.phrases[this.phraseIdx]); };
  }

  async begin({ mode, minutes, phrase, prefs, onDone }) {
    this.kill();
    this.mode = mode; this.onDone = onDone; this.prefs = prefs;
    this.guide.sound = prefs.sound; this.guide.voice = prefs.voice;
    $('sess-sound').classList.toggle('off', !(prefs.sound || prefs.voice));
    this.total = mode === 'tense' ? 10 : mode === 'motion' ? 60 : minutes * 60;
    this.elapsed = 0; this.phaseIdx = -1; this.userExp = 0.5; this.sync = 0; this.syncAcc = 0; this.syncN = 0;
    this.holdAcc = 0; this.stage = 0; this.done = false; this.sensorUsed = null;
    $('sess-mode').textContent = LIBRARY[mode].title;
    $('reach-card').hidden = mode !== 'reach';
    $('sess-meter').hidden = !['breath', 'sleep', 'motion'].includes(mode);
    $('sensor-switch').hidden = !['breath', 'sleep'].includes(mode);
    $('sens-wrap').hidden = true;
    $('sess-stats').innerHTML = '';
    document.body.classList.toggle('sleep-dim', mode === 'sleep');
    Object.assign(this.orb.state, { guide: 0.5, user: null, energy: 0, sync: 0, blend: 0, dim: 0, points: null, progress: 0,
      palette: { sleep: 'sleep', motion: 'motion', tense: 'tense' }[mode] || 'calm' });
    this.orb.auto = ['walk', 'reach'].includes(mode);
    this.orb.start();

    if (mode === 'reach') {
      this.phrases = [phrase, ...EXTRA_PHRASES.filter((p) => p !== phrase)].filter(Boolean);
      this.phraseIdx = 0; this.setPhrase(this.phrases[0]);
    }
    this.cue(...({
      breath: ['Prepárate', 'Siéntate cómodo/a y suelta los hombros'],
      sleep: ['Prepárate para descansar', 'La pantalla se irá apagando contigo'],
      tense: ['Micro-pausa de 10 segundos', 'Mantén pulsado y aprieta los puños'],
      motion: ['Ponte de pie si puedes', 'Vamos a despertar el cuerpo 60 segundos'],
      walk: ['Levántate y cambia de espacio', 'Toma agua, abre una ventana o camina. Te avisaremos al terminar.'],
      reach: ['Respira mientras decides', 'Una conversación también es una pausa'],
    })[mode]);

    if (mode === 'breath' || mode === 'sleep') await this.useSensor(prefs.sensors ? 'mic' : 'touch');
    else if (mode === 'tense') await this.useSensor('touch');
    else if (mode === 'motion') await this.useMotion(prefs.sensors);
    else this.privacy('Sin sensores activos. PAUSA no envía nada: solo cuenta el tiempo.');

    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), 33);
  }

  setPhrase(p) {
    this.phrase = p; $('reach-phrase').textContent = `“${p}”`;
    $('reach-wa').href = `https://wa.me/?text=${encodeURIComponent(p)}`;
  }

  cue(main, sub = '') { $('cue-main').textContent = main; $('cue-sub').textContent = sub; }
  privacy(html) { $('privacy-live').innerHTML = html; }

  async useSensor(kind) {
    this.sensor?.stop();
    this.sensor = null;
    const onEvent = (ev) => {
      if (ev === 'calibrated') { this.cue('Listo', 'Exhala suave hacia el micrófono cuando la luz se contraiga'); this.phaseIdx = -1; this.cycleStart = this.elapsed; }
    };
    if (kind === 'mic') {
      try {
        const s = new BreathSensor(onEvent);
        await s.start();
        s.sensitivity = +$('sens').value;
        this.sensor = s; this.sensorUsed = 'mic';
        this.cue('Silencio un momento…', 'Calibrando el ruido de tu espacio (2 s)');
        this.privacy('🔒 <b>Micrófono en memoria</b> · se analiza energía y planitud espectral cada 30 ms · <b>0 bytes grabados o enviados</b>');
      } catch {
        this.toast('Micrófono no disponible: usamos el modo táctil.');
        return this.useSensor('touch');
      }
    } else {
      const s = new TouchBreath($('tap-zone'), onEvent);
      await s.start();
      this.sensor = s; this.sensorUsed = this.sensorUsed || 'touch';
      if (this.mode !== 'tense') this.cue('Modo táctil', 'Mantén pulsado mientras inhalas, suelta para exhalar');
      this.privacy('Modo táctil · sin micrófono ni cámara. Barra espaciadora o pulsación sostenida.');
    }
    $('sens-wrap').hidden = kind !== 'mic';
    $('tap-zone').hidden = kind !== 'touch';
    [...$('sensor-switch').children].forEach((b) => b.classList.toggle('on', b.dataset.src === kind));
    this.cycleStart = this.elapsed; this.phaseIdx = -1;
  }

  async useMotion(allowed) {
    if (allowed) {
      try {
        const m = new MotionSensor(); await m.start();
        this.motion = m; this.sensorUsed = 'camera';
        this.privacy('🔒 <b>Cámara a 64×48 px en memoria</b> · solo se mide movimiento; la imagen nunca se muestra, guarda ni envía');
        return;
      } catch { this.toast('Cámara no disponible: sigue las indicaciones sin medición.'); }
    }
    this.privacy('Sin cámara · sigue las indicaciones a tu ritmo.');
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const calibrating = this.sensor?.calibrating;
    if (!calibrating) this.elapsed += dt;
    const left = this.total - this.elapsed;
    $('sess-timer').textContent = fmt(Math.max(0, left));
    this.orb.state.progress = this.elapsed / this.total;
    if (this.mode === 'breath' || this.mode === 'sleep') this.tickBreath(dt, calibrating);
    else if (this.mode === 'tense') this.tickTense(dt);
    else if (this.mode === 'motion') this.tickMotion();
    if (this.mode === 'sleep') this.orb.state.dim = Math.min(0.85, this.elapsed / this.total);
    if (left <= 0 && this.mode !== 'tense') this.finish(true);
  }

  tickBreath(dt, calibrating) {
    const s = this.sensor; if (!s) return;
    const meterLevel = s.kind === 'mic' ? s.level : (s.holding ? 1 : 0) * s.level;
    $('meter-level').style.width = `${Math.round(meterLevel * 100)}%`;
    if (calibrating) { this.orb.state.user = null; this.orb.state.guide = 0.5; return; }

    const rhythm = RHYTHMS[this.mode];
    const cycle = rhythm.reduce((a, p) => a + p.s, 0);
    let t = (this.elapsed - (this.cycleStart || 0)) % cycle; let idx = 0;
    while (t >= rhythm[idx].s) { t -= rhythm[idx].s; idx++; }
    const ph = rhythm[idx]; const p = t / ph.s;
    if (idx !== this.phaseIdx) {
      this.phaseIdx = idx;
      this.guide.phase(ph.k, ph.s, ph.voice);
      if (this.guide.voice) s.mute(900);
      this.cue(ph.cue, this.mode === 'sleep' ? '' : (s.kind === 'mic' ? (ph.k === 'out' ? 'Deja salir el aire hacia el micrófono' : 'Por la nariz, sin forzar') : (ph.k === 'in' ? 'Mantén pulsado' : 'Suelta')));
    }
    const guide = ph.k === 'in' ? ease(p) : ph.k === 'hold' ? 1 : 1 - ease(p);

    let match;
    if (s.kind === 'mic') {
      const exhaling = s.phase === 'out';
      this.userExp += exhaling ? -dt * (0.12 + s.level * 0.45) : dt / 4.5;
      match = ph.k === 'out' ? exhaling : !exhaling;
      if (ph.k === 'out' && exhaling && p > 0.15) $('cue-sub').textContent = 'Así… deja que la luz se lleve el aire';
      this.orb.state.energy = s.level;
    } else {
      this.userExp += s.holding ? dt / 4 : -dt / 6;
      match = ph.k === 'in' ? s.holding : ph.k === 'hold' ? true : !s.holding;
      this.orb.state.energy = s.phase === 'out' && !s.holding ? Math.max(0, 0.5 - (performance.now() - s.releasedAt) / 6000) : 0;
    }
    this.userExp = Math.min(1, Math.max(0, this.userExp));
    this.sync += ((match ? 1 : 0) - this.sync) * 0.03;
    this.syncAcc += match ? 1 : 0; this.syncN += 1;
    Object.assign(this.orb.state, { guide, user: this.userExp, sync: this.sync, blend: ph.k === 'out' ? 1 : 0 });

    if ((this.statT = (this.statT || 0) + dt) > 0.5) {
      this.statT = 0;
      const st = s.stats;
      const sintonia = this.sync > 0.7 ? 'alta' : this.sync > 0.45 ? 'media' : 'buscándola';
      $('sess-stats').innerHTML = `<span>Respiraciones <b>${st.cycles}</b></span><span>Ritmo <b>${st.rate ? st.rate.toFixed(1) + '/min' : '—'}</b></span>`
        + `<span>Última exhalación <b>${st.lastExhale ? st.lastExhale.toFixed(1) + ' s' : '—'}</b></span><span>Sintonía con la guía <b>${sintonia}</b></span>`;
    }
  }

  tickTense(dt) {
    const s = this.sensor; if (!s) return;
    if (this.stage === 0) {
      this.elapsed = Math.min(this.elapsed, this.holdAcc); // el tiempo solo avanza mientras tensas
      if (s.holding) {
        this.holdAcc += dt;
        if (!this.tenseStarted) { this.tenseStarted = true; this.guide.phase('in', 5, 'Aprieta'); }
        this.cue(`Aprieta ${Math.ceil(5 - this.holdAcc)}`, 'Puños, hombros y mandíbula. Fuerte.');
      } else if (this.holdAcc > 0) this.cue('Sigue pulsando', 'Mantén la tensión hasta llegar a 5');
      Object.assign(this.orb.state, { guide: 0.5 - 0.4 * Math.min(1, this.holdAcc / 5), energy: s.holding ? 0.1 : 0 });
      if (this.holdAcc >= 5) { this.stage = 1; this.releaseAt = this.elapsed; this.cue('Suelta', 'Abre las manos. Siente el hormigueo'); this.guide.phase('out', 5, 'Suelta'); }
    } else {
      const p = (this.elapsed - this.releaseAt) / 5;
      Object.assign(this.orb.state, { guide: 0.1 + 0.85 * ease(p), energy: Math.max(0, 1 - p * 1.3), palette: 'calm' });
      if (p >= 0.5) $('cue-sub').textContent = 'Nota cómo cambia tu cuerpo';
      if (p >= 1) this.finish(true);
    }
  }

  tickMotion() {
    const i = Math.min(MOTION_STEPS.length - 1, Math.floor(this.elapsed / 15));
    const step = MOTION_STEPS[i];
    if (i !== this.stage || this.phaseIdx === -1) {
      this.stage = i; this.phaseIdx = 0;
      this.guide.phase(i === 3 ? 'out' : 'in', 15, step.cue);
      this.cue(step.cue, step.sub);
    }
    const m = this.motion;
    if (m) {
      Object.assign(this.orb.state, { energy: m.level, points: m.points, guide: 0.35 + 0.5 * Math.min(1, m.level * 2.5) });
      $('meter-level').style.width = `${Math.round(Math.min(1, m.level * 2) * 100)}%`;
      $('sess-meter').querySelector('.meter-row span').textContent = 'Energía de movimiento';
      if (i === 3) $('cue-sub').textContent = m.level < 0.06 ? 'Así, en quietud. Bien.' : 'Poco a poco, quédate quieto/a';
      else if (m.level < 0.04 && this.elapsed % 15 > 3) $('cue-sub').textContent = 'Muévete un poco más amplio';
      else $('cue-sub').textContent = step.sub;
    } else {
      this.orb.state.guide = 0.5 + 0.3 * Math.sin(this.elapsed * 1.2);
    }
  }

  summary() {
    const st = this.sensor?.stats || {};
    return {
      mode: this.mode, sensor: this.sensorUsed, duration: Math.round(this.elapsed),
      cycles: st.cycles || 0, rate: st.rate ? +st.rate.toFixed(1) : null,
      longest: st.longest ? +st.longest.toFixed(1) : null,
      sync: this.syncN ? Math.round((this.syncAcc / this.syncN) * 100) : null,
      motion: this.motion ? +this.motion.energy.toFixed(1) : null,
    };
  }

  finish(completed) {
    if (this.done) return;
    this.done = true;
    const result = { ...this.summary(), completed };
    if (completed) this.guide.chime();
    this.kill();
    this.onDone?.(result);
  }

  /** Corta todo al instante (también lo usa el modo discreto). */
  kill() {
    clearInterval(this.timer); this.timer = null;
    this.sensor?.stop(); this.sensor = null;
    this.motion?.stop(); this.motion = null;
    this.guide.silence();
    this.orb.stop();
    this.tenseStarted = false;
    $('tap-zone').hidden = true;
    document.body.classList.remove('sleep-dim');
  }
}

// Sensores de respiración. El audio NUNCA se graba ni se transmite: cada ~30 ms se
// calcula energía y planitud espectral en memoria y el búfer se sobrescribe.

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function rateFrom(onsets) {
  const iv = [];
  for (let i = 1; i < onsets.length; i++) { const d = (onsets[i] - onsets[i - 1]) / 1000; if (d >= 1.8 && d <= 25) iv.push(d); }
  const m = median(iv.slice(-5));
  return m ? 60 / m : null;
}

/** Detección de exhalación por micrófono: la exhalación es ruido de banda ancha (planitud alta),
 *  la voz y los tonos son armónicos (planitud baja). Umbral adaptativo con histéresis. */
export class BreathSensor {
  constructor(onEvent = () => {}) {
    this.kind = 'mic';
    this.onEvent = onEvent;
    this.level = 0; this.phase = 'idle'; this.calibrating = true;
    this.onsets = []; this.exhales = []; this.sensitivity = 0; this.muteUntil = 0;
    this.db = -100; this.flatness = 0; this.floor = null;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    this.an = this.ctx.createAnalyser(); this.an.fftSize = 1024; this.an.smoothingTimeConstant = 0.25;
    src.connect(hp).connect(this.an);
    this.spec = new Float32Array(this.an.frequencyBinCount);
    const binHz = this.ctx.sampleRate / this.an.fftSize;
    this.lo = Math.max(1, Math.floor(150 / binHz)); this.hi = Math.floor(4000 / binHz);
    this.calib = []; this.calStart = performance.now();
    this.timer = setInterval(() => this.tick(), 30);
  }

  mute(ms) { this.muteUntil = performance.now() + ms; }

  tick() {
    this.an.getFloatFrequencyData(this.spec);
    let lin = 0, log = 0, n = 0;
    for (let i = this.lo; i <= this.hi; i++) {
      const p = Math.pow(10, this.spec[i] / 10) + 1e-14;
      lin += p; log += Math.log(p); n++;
    }
    const mean = lin / n;
    this.db = 10 * Math.log10(mean);
    this.flatness = Math.exp(log / n) / mean;
    const now = performance.now();

    if (this.calibrating) {
      this.calib.push(this.db);
      if (now - this.calStart > 2200) {
        this.floor = median(this.calib);
        this.calibrating = false;
        this.onEvent('calibrated');
      }
      return;
    }

    const on = this.floor + 9 - this.sensitivity;
    const off = this.floor + 5 - this.sensitivity;
    const breathy = this.flatness > 0.16;
    const muted = now < this.muteUntil;
    const raw = Math.max(0, Math.min(1, (this.db - off) / 22));
    this.level += ((breathy && !muted ? raw : 0) - this.level) * 0.35;

    if (this.phase !== 'out' && this.db > on && breathy && !muted) {
      this.phase = 'out'; this.outStart = now;
      this.onEvent('exhale-start');
    } else if (this.phase === 'out' && (this.db < off || !breathy)) {
      this.phase = 'idle';
      const dur = (now - this.outStart) / 1000;
      if (dur >= 0.6) {
        this.onsets.push(this.outStart); this.exhales.push(dur);
        this.onEvent('exhale-end', dur);
      }
    }
    // el piso de ruido se adapta lentamente cuando no hay exhalación (salas ruidosas)
    if (this.phase !== 'out') this.floor += (this.db - this.floor) * (this.db < this.floor ? 0.05 : 0.004);
  }

  get stats() {
    return { cycles: this.exhales.length, rate: rateFrom(this.onsets), lastExhale: this.exhales.at(-1) ?? null, longest: this.exhales.length ? Math.max(...this.exhales) : null };
  }

  stop() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.spec = null; this.stream = null; this.ctx = null;
  }
}

/** Alternativa táctil sin sensores: mantener pulsado = inhalar, soltar = exhalar. */
export class TouchBreath {
  constructor(zone, onEvent = () => {}) {
    this.kind = 'touch';
    this.zone = zone; this.onEvent = onEvent;
    this.level = 0; this.phase = 'idle'; this.calibrating = false; this.holding = false;
    this.onsets = []; this.holds = []; this.exhales = [];
    this.down = (e) => { if (e.type === 'keydown' && (e.code !== 'Space' || e.repeat)) return; if (e.type === 'keydown') e.preventDefault(); this.press(true); };
    this.up = (e) => { if (e.type === 'keyup' && e.code !== 'Space') return; this.press(false); };
  }

  start() {
    this.zone.hidden = false;
    this.zone.addEventListener('pointerdown', this.down);
    window.addEventListener('pointerup', this.up);
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    this.timer = setInterval(() => {
      const target = this.holding ? 1 : 0;
      this.level += (target - this.level) * (this.holding ? 0.05 : 0.04);
      if (!this.holding && this.phase === 'out' && performance.now() - this.releasedAt > 9000) this.phase = 'idle';
    }, 30);
    return Promise.resolve();
  }

  press(isDown) {
    const now = performance.now();
    if (isDown && !this.holding) {
      this.holding = true; this.phase = 'in'; this.pressedAt = now;
      if (this.releasedAt) this.exhales.push((now - this.releasedAt) / 1000);
      this.onsets.push(now); this.onEvent('inhale-start');
    } else if (!isDown && this.holding) {
      this.holding = false; this.phase = 'out'; this.releasedAt = now;
      const d = (now - this.pressedAt) / 1000; this.holds.push(d);
      this.onEvent('inhale-end', d);
    }
  }

  mute() {}
  get stats() { return { cycles: this.holds.length, rate: rateFrom(this.onsets), lastHold: this.holds.at(-1) ?? null, lastExhale: this.exhales.at(-1) ?? null }; }

  stop() {
    clearInterval(this.timer);
    this.zone.hidden = true;
    this.zone.removeEventListener('pointerdown', this.down);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
  }
}

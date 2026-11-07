// Guía por sonido (síntesis WebAudio) y por voz (solo voces locales del sistema: localService).
export class Guide {
  constructor() { this.sound = true; this.voice = true; this.voiceObj = null; }

  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain(); this.master.gain.value = 0;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      this.oscs = [0, 7, -5].map((det, i) => {
        const o = this.ctx.createOscillator(); o.type = i === 2 ? 'triangle' : 'sine'; o.frequency.value = 196; o.detune.value = det;
        const g = this.ctx.createGain(); g.gain.value = i === 2 ? 0.25 : 0.5; o.connect(g).connect(lp); o.start(); return o;
      });
      lp.connect(this.master).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.voiceObj && 'speechSynthesis' in window) {
      const pick = () => {
        const vs = speechSynthesis.getVoices().filter((v) => v.localService && v.lang.toLowerCase().startsWith('es'));
        this.voiceObj = vs.find((v) => /es-(PE|MX|US|419)/i.test(v.lang)) || vs[0] || null;
      };
      pick(); speechSynthesis.onvoiceschanged = pick;
    }
  }

  phase(kind, seconds, label) {
    this.ensure();
    const t = this.ctx.currentTime;
    const f = { in: [174, 247], hold: [247, 247], out: [247, 156] }[kind] || [196, 196];
    const gain = this.sound ? (kind === 'hold' ? 0.035 : 0.055) : 0;
    this.oscs.forEach((o) => { o.frequency.cancelScheduledValues(t); o.frequency.setValueAtTime(f[0], t); o.frequency.linearRampToValueAtTime(f[1], t + seconds); });
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(gain, t, 0.4);
    if (label) this.speak(label);
  }

  speak(text) {
    if (!this.voice || !('speechSynthesis' in window) || !this.voiceObj) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = this.voiceObj; u.lang = this.voiceObj.lang; u.rate = 0.82; u.pitch = 0.95; u.volume = 0.85;
    speechSynthesis.speak(u);
  }

  chime() {
    this.ensure();
    if (!this.sound) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((fr, i) => {
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.frequency.value = fr; g.gain.setValueAtTime(0, t + i * 0.18);
      g.gain.linearRampToValueAtTime(0.08, t + i * 0.18 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 2.2);
      o.connect(g).connect(this.ctx.destination); o.start(t + i * 0.18); o.stop(t + i * 0.18 + 2.3);
    });
  }

  silence() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }
}

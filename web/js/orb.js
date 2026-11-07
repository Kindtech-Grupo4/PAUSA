// Orbe generativo en Canvas 2D: la forma sigue tu respiración, el anillo muestra la guía,
// las partículas nacen de tu exhalación real.
const PALETTES = {
  calm: { a: '#d9fff7', b: '#5eead4', c: '#6d28d9', glow: '#5eead4' },
  out: { a: '#efe9ff', b: '#a78bfa', c: '#1e3a8a', glow: '#a78bfa' },
  sleep: { a: '#fff4d6', b: '#fbbf24', c: '#7c2d12', glow: '#f59e0b' },
  motion: { a: '#e0f2fe', b: '#38bdf8', c: '#4c1d95', glow: '#38bdf8' },
  tense: { a: '#ffe4e6', b: '#fb7185', c: '#4c1d95', glow: '#fb7185' },
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (h1, h2, t) => { const a = hex(h1), b = hex(h2); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; };
const rgba = (h, al) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${al})`; };

export class Orb {
  constructor(canvas, opts = {}) {
    this.cv = canvas; this.cx = canvas.getContext('2d');
    this.auto = !!opts.auto;
    this.state = { guide: 0.5, user: null, energy: 0, sync: 0, palette: opts.palette || 'calm', dim: 0, points: null, blend: 0, progress: null };
    this.shown = 0.5; this.blendShown = 0; this.particles = []; this.t0 = performance.now();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.cv.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.cv.width = Math.max(1, r.width * dpr); this.cv.height = Math.max(1, r.height * dpr);
    this.cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start() { this.resize(); if (!this.raf) { const loop = () => { this.draw(); this.raf = requestAnimationFrame(loop); }; loop(); } }
  stop() { cancelAnimationFrame(this.raf); this.raf = null; }
  destroy() { this.stop(); this.ro.disconnect(); }

  draw() {
    const { cx, w, h } = this; const s = this.state;
    const t = (performance.now() - this.t0) / 1000;
    const reduce = document.documentElement.classList.contains('reduce-motion');
    if (this.auto) { const ph = t % 10; s.guide = ph < 4 ? 0.5 - 0.5 * Math.cos(Math.PI * ph / 4) : 0.5 + 0.5 * Math.cos(Math.PI * (ph - 4) / 6); }
    const target = s.user ?? s.guide;
    this.shown += (target - this.shown) * 0.08;
    this.blendShown += (s.blend - this.blendShown) * 0.05;

    const pal = PALETTES[s.palette] || PALETTES.calm;
    const alt = s.palette === 'calm' ? PALETTES.out : pal;
    const k = this.blendShown;
    const A = mix(pal.a, alt.a, k), B = mix(pal.b, alt.b, k), C = mix(pal.c, alt.c, k);
    const glowHex = s.sync > 0.5 ? '#a7f3d0' : pal.glow;

    cx.clearRect(0, 0, w, h);
    cx.globalAlpha = 1 - s.dim * 0.92;
    const X = w / 2, Y = h / 2, R = Math.min(w, h) / 2;
    const rr = R * (0.3 + 0.2 * this.shown);

    // halo
    const g = cx.createRadialGradient(X, Y, rr * 0.5, X, Y, R);
    g.addColorStop(0, rgba(glowHex, 0.28 + 0.25 * s.sync + 0.25 * s.energy));
    g.addColorStop(1, rgba(glowHex, 0));
    cx.fillStyle = g; cx.beginPath(); cx.arc(X, Y, R, 0, Math.PI * 2); cx.fill();

    // anillo guía (objetivo) cuando hay respiración del usuario
    if (s.user !== null && s.user !== undefined) {
      const gr = R * (0.3 + 0.2 * s.guide) + 10;
      cx.strokeStyle = `rgba(255,255,255,${0.22 + 0.3 * s.sync})`; cx.lineWidth = 1.5;
      cx.setLineDash([3, 7]); cx.beginPath(); cx.arc(X, Y, gr, 0, Math.PI * 2); cx.stroke(); cx.setLineDash([]);
    }
    // progreso circular
    if (s.progress !== null) {
      cx.strokeStyle = rgba(pal.glow, 0.85); cx.lineWidth = 3; cx.lineCap = 'round';
      cx.beginPath(); cx.arc(X, Y, R * 0.93, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, s.progress)); cx.stroke();
      cx.strokeStyle = 'rgba(255,255,255,.07)'; cx.beginPath(); cx.arc(X, Y, R * 0.93, 0, Math.PI * 2); cx.stroke();
    }

    // forma orgánica
    const wob = reduce ? 0.01 : 0.022 + s.energy * 0.07;
    cx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const n = Math.sin(a * 3 + t * 0.9) * 0.5 + Math.sin(a * 5 - t * 1.3) * 0.3 + Math.sin(a * 7 + t * 2.1) * 0.2;
      const r = rr * (1 + wob * n);
      const x = X + Math.cos(a) * r, y = Y + Math.sin(a) * r;
      i ? cx.lineTo(x, y) : cx.moveTo(x, y);
    }
    const fill = cx.createRadialGradient(X - rr * 0.35, Y - rr * 0.4, rr * 0.05, X, Y, rr * 1.1);
    fill.addColorStop(0, A); fill.addColorStop(0.45, B); fill.addColorStop(1, C);
    cx.fillStyle = fill; cx.shadowColor = rgba(pal.glow, 0.7); cx.shadowBlur = 40; cx.fill(); cx.shadowBlur = 0;

    // brillo interno
    cx.globalCompositeOperation = 'lighter';
    const inner = cx.createRadialGradient(X, Y, 0, X, Y, rr * 0.8);
    inner.addColorStop(0, `rgba(255,255,255,${0.12 + 0.2 * s.energy})`); inner.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = inner; cx.beginPath(); cx.arc(X, Y, rr * 0.8, 0, Math.PI * 2); cx.fill();

    // partículas de exhalación
    if (!reduce && s.energy > 0.04) {
      const n = Math.min(8, Math.round(s.energy * 9));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = (0.6 + Math.random() * 2.2) * (0.4 + s.energy) * R / 180;
        this.particles.push({ x: X + Math.cos(a) * rr, y: Y + Math.sin(a) * rr, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, size: 1 + Math.random() * 2.4 });
      }
    }
    for (const p of this.particles) {
      p.x += p.vx; p.y += p.vy; p.vx *= 0.985; p.vy *= 0.985; p.life -= 0.012;
      cx.fillStyle = rgba(pal.glow, Math.max(0, p.life) * 0.8);
      cx.beginPath(); cx.arc(p.x, p.y, p.size, 0, Math.PI * 2); cx.fill();
    }
    this.particles = this.particles.filter((p) => p.life > 0).slice(-700);

    // silueta abstracta de movimiento (sin imagen de cámara)
    if (s.points) {
      cx.fillStyle = 'rgba(224,242,254,.9)';
      for (const [px, py, d] of s.points) {
        cx.globalAlpha = Math.min(1, 0.25 + d * 2) * (1 - s.dim * 0.9);
        cx.fillRect(X + (px - 0.5) * R * 1.5, Y + (py - 0.5) * R * 1.12, 2.2, 2.2);
      }
    }
    cx.globalCompositeOperation = 'source-over';
    cx.globalAlpha = 1;
  }
}

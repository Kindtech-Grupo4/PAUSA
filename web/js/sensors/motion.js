// Movimiento por diferencia de fotogramas a 64x48 px en memoria. No se muestra ni guarda
// ninguna imagen: solo se extrae la energía de movimiento y puntos abstractos.
export class MotionSensor {
  constructor() { this.level = 0; this.points = []; this.energy = 0; }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 160, height: 120, facingMode: 'user' }, audio: false });
    this.video = document.createElement('video');
    this.video.muted = true; this.video.playsInline = true; this.video.srcObject = this.stream;
    await this.video.play();
    this.w = 64; this.h = 48;
    this.cv = new OffscreenCanvas(this.w, this.h);
    this.cx = this.cv.getContext('2d', { willReadFrequently: true });
    this.prev = null;
    this.timer = setInterval(() => this.tick(), 66);
  }

  tick() {
    this.cx.drawImage(this.video, 0, 0, this.w, this.h);
    const px = this.cx.getImageData(0, 0, this.w, this.h).data;
    const gray = new Uint8Array(this.w * this.h);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) gray[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
    if (this.prev) {
      let sum = 0; const pts = [];
      for (let j = 0; j < gray.length; j++) {
        const d = Math.abs(gray[j] - this.prev[j]);
        if (d > 22) { sum += d; if ((j & 1) === 0) pts.push([1 - (j % this.w) / this.w, Math.floor(j / this.w) / this.h, d / 255]); }
      }
      const raw = Math.min(1, sum / (gray.length * 18));
      this.level += (raw - this.level) * 0.4;
      this.energy += this.level * 0.066;
      this.points = pts.length > 500 ? pts.filter((_, i) => i % Math.ceil(pts.length / 500) === 0) : pts;
    }
    this.prev = gray;
  }

  stop() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.srcObject = null;
    this.prev = null; this.points = []; this.stream = null;
  }
}

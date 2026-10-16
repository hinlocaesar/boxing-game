/**
 * Procedural broadcast audio. Everything here is synthesised with the Web
 * Audio API so the game ships with zero audio assets.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private crowdSource: AudioBufferSourceNode | null = null;
  private noise: AudioBuffer | null = null;
  private excitement = 0.2;
  private targetExcitement = 0.2;
  enabled = true;

  /** Must be called from a user gesture. */
  async unlock(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    await this.ctx.resume();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    this.master.connect(this.ctx.destination);

    // Noise buffer used by crowd / impacts / swooshes.
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = white * 0.6 + last * 3.2;
    }
    this.noise = buf;

    // Crowd bed.
    this.crowdFilter = this.ctx.createBiquadFilter();
    this.crowdFilter.type = "lowpass";
    this.crowdFilter.frequency.value = 900;
    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0.09;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.crowdFilter).connect(this.crowdGain).connect(this.master);
    src.start();
    this.crowdSource = src;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v ? 0.9 : 0, this.ctx.currentTime, 0.08);
    }
  }

  /** 0 = quiet arena, 1 = absolute bedlam. */
  setExcitement(v: number): void {
    this.targetExcitement = Math.max(0, Math.min(1, v));
  }

  update(dt: number): void {
    if (!this.ctx || !this.crowdGain || !this.crowdFilter) return;
    this.excitement += (this.targetExcitement - this.excitement) * Math.min(1, dt * 1.4);
    const e = this.excitement;
    this.crowdGain.gain.setTargetAtTime(0.07 + e * 0.22, this.ctx.currentTime, 0.3);
    this.crowdFilter.frequency.setTargetAtTime(700 + e * 1400, this.ctx.currentTime, 0.3);
  }

  /* ---------------- one-shots ---------------- */

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private noiseSource(): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noise) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    return s;
  }

  punch(power = 1, blocked = false): void {
    if (!this.ctx || !this.master) return;
    const t = this.now();
    const p = Math.max(0.25, Math.min(1.6, power));

    // Low thump.
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    const g = this.ctx.createGain();
    const f0 = blocked ? 150 : 130;
    osc.frequency.setValueAtTime(f0 * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.16);
    const peak = (blocked ? 0.18 : 0.5) * p;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.25);

    // Leather slap.
    const n = this.noiseSource();
    if (n) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(blocked ? 2600 : 1500, t);
      bp.frequency.exponentialRampToValueAtTime(blocked ? 900 : 620, t + 0.1);
      bp.Q.value = 0.9;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime((blocked ? 0.22 : 0.42) * p, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      n.connect(bp).connect(ng).connect(this.master);
      n.start(t);
      n.stop(t + 0.16);
    }
    this.cheer(blocked ? 0.1 : p * 0.35);
  }

  whiff(): void {
    if (!this.ctx || !this.master) return;
    const t = this.now();
    const n = this.noiseSource();
    if (!n) return;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(1600, t);
    bp.frequency.exponentialRampToValueAtTime(420, t + 0.16);
    bp.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.2);
  }

  bell(times = 3, gap = 0.42): void {
    if (!this.ctx || !this.master) return;
    const start = this.now();
    for (let i = 0; i < times; i++) {
      const t = start + i * gap;
      const partials = [1046, 1568, 2093, 3136];
      const gains = [0.3, 0.18, 0.12, 0.06];
      partials.forEach((f, k) => {
        const osc = this.ctx!.createOscillator();
        osc.type = "sine";
        osc.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
        const g = this.ctx!.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gains[k], t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 1.4);
        osc.connect(g).connect(this.master!);
        osc.start(t);
        osc.stop(t + 1.5);
      });
    }
    this.cheer(0.4);
  }

  cheer(amount = 0.4): void {
    if (!this.ctx || !this.master) return;
    const t = this.now();
    const n = this.noiseSource();
    if (!n) return;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1100;
    bp.Q.value = 0.5;
    const g = this.ctx.createGain();
    const a = Math.min(0.4, amount * 0.35);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(a, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 1.2);
    this.setExcitement(Math.min(1, this.targetExcitement + amount * 0.4));
  }

  gong(): void {
    if (!this.ctx || !this.master) return;
    const t = this.now();
    [82, 164, 247, 331].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.26 / (i + 1), t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 3.2);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 3.3);
    });
  }

  countBlip(n: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 220 + n * 30;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.24);
  }

  dispose(): void {
    this.crowdSource?.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}

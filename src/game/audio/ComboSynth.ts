/**
 * Procedural sound for the jump-combo system — uses WebAudio nodes only, no asset files.
 *
 * Each combo `tier` plays a brief stack of:
 *   - A pitched oscillator (sine → square → sawtooth as the tier rises)
 *   - A noise-burst drum click underneath
 *   - Optional waveshaper distortion above tier 10 for a bitcrush bite
 *
 * The audio context is created lazily on the first `play()` call (autoplay-policy friendly),
 * and surfaces a `resume()` helper for callers that already have a user-gesture handler.
 */
export class ComboSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private waveshaper: WaveShaperNode | null = null;
  private failed = false;

  /** Lazily create the AudioContext + master gain on first play (works around autoplay policies). */
  private ensureContext(): boolean {
    if (this.ctx) {
      return true;
    }
    if (this.failed || typeof window === 'undefined') {
      return false;
    }

    try {
      const win = window as Window &
        typeof globalThis & { webkitAudioContext?: typeof AudioContext };
      const Ctor = window.AudioContext ?? win.webkitAudioContext;
      if (!Ctor) {
        this.failed = true;
        return false;
      }
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);

      const waveshaper = ctx.createWaveShaper();
      waveshaper.curve = ComboSynth.makeDistortionCurve(34);
      waveshaper.oversample = '2x';
      waveshaper.connect(master);

      this.ctx = ctx;
      this.master = master;
      this.waveshaper = waveshaper;
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }

  /** Soft-saturation curve (~tanh-ish), parameterized by `amount`. Explicitly typed against a
   *  concrete `ArrayBuffer` so the resulting view is assignable to `WaveShaperNode.curve` under
   *  the newer DOM typings (which reject the generic `ArrayBufferLike` form). */
  private static makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const buffer = new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT);
    const curve = new Float32Array(buffer);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; i += 1) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  /**
   * Play one combo hit. `tier` is 0-based (0 = first level, "QUICK").
   * Higher tier = higher pitch, harsher waveform, louder drum, optional distortion.
   */
  play(tier: number): void {
    if (!this.ensureContext() || !this.ctx || !this.master) {
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    /** Semitone steps from A3 (220 Hz). Combo tier 0 starts low, scales to ~2.5 octaves at tier 14. */
    const freq = 220 * Math.pow(2, tier / 12);
    const oscType: OscillatorType =
      tier < 6 ? 'sine' : tier < 10 ? 'square' : 'sawtooth';

    const osc = ctx.createOscillator();
    osc.type = oscType;
    osc.frequency.setValueAtTime(freq, now);
    /** Brief upward bend — gives every hit a "rising" feel even though we vary the base pitch. */
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.42, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    osc.connect(gain);
    /** Tier 10+ ("INSANE" and above) routes through the distortion stage for a heavier bite. */
    if (tier >= 10 && this.waveshaper) {
      gain.connect(this.waveshaper);
    } else {
      gain.connect(this.master);
    }
    osc.start(now);
    osc.stop(now + 0.28);

    /** Drum click — 30 ms of decaying white noise so each hit lands like a percussive thud. */
    const noiseLen = Math.floor(ctx.sampleRate * 0.03);
    const noiseBuf = ctx.createBuffer(1, Math.max(1, noiseLen), ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i += 1) {
      noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = Math.min(0.45, 0.16 + tier * 0.02);
    noise.connect(noiseGain);
    noiseGain.connect(this.master);
    noise.start(now);
    noise.stop(now + 0.04);

    /** Extra layered "octave shimmer" for the highest tiers — feels like a stinger. */
    if (tier >= 8) {
      const high = ctx.createOscillator();
      high.type = 'triangle';
      high.frequency.setValueAtTime(freq * 2, now);
      const highGain = ctx.createGain();
      highGain.gain.setValueAtTime(0, now);
      highGain.gain.linearRampToValueAtTime(0.18, now + 0.01);
      highGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      high.connect(highGain);
      highGain.connect(this.master);
      high.start(now);
      high.stop(now + 0.2);
    }
  }

  /** Best-effort resume — call from a user-gesture path (e.g. first jump) if autoplay was suspended. */
  resume(): void {
    void this.ctx?.resume().catch(() => {
      /* ignore: some browsers reject without a gesture */
    });
  }

  dispose(): void {
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        /* ignore */
      }
    }
    this.ctx = null;
    this.master = null;
    this.waveshaper = null;
  }
}

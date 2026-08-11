/**
 * All sound is synthesized at runtime with the Web Audio API — there are no
 * audio files anywhere in this project. This keeps the entire game as text
 * (the constraint that makes it buildable start-to-finish in Claude Code).
 */

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  /** Must be called from a user gesture (browsers block autoplay). */
  resume() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = "sine",
    gain = 1,
  ) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const now = this.ctx.currentTime;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(env);
    env.connect(this.master);
    osc.start(now);
    osc.stop(now + dur);
  }

  /** Short blip when an ingredient is added. */
  pop() {
    this.tone(520, 0.08, "square", 0.5);
  }

  /** Rising two-note chime — order served correctly. */
  ding() {
    this.tone(880, 0.12, "sine", 0.7);
    setTimeout(() => this.tone(1320, 0.18, "sine", 0.6), 90);
  }

  /** Low buzz — mistake / burnt / wrong order. */
  buzz() {
    this.tone(140, 0.25, "sawtooth", 0.5);
  }

  /** Perfect-grill sparkle. */
  perfect() {
    this.tone(1046, 0.1, "triangle", 0.6);
    setTimeout(() => this.tone(1568, 0.14, "triangle", 0.5), 70);
  }

  /** Sizzle burst using filtered white noise. */
  sizzle() {
    if (!this.enabled || !this.ctx || !this.master) return;
    const dur = 0.3;
    const buffer = this.ctx.createBuffer(
      1,
      this.ctx.sampleRate * dur,
      this.ctx.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 3200;
    const env = this.ctx.createGain();
    const now = this.ctx.currentTime;
    env.gain.setValueAtTime(0.25, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.master);
    src.start(now);
    src.stop(now + dur);
  }
}

export const audio = new AudioEngine();

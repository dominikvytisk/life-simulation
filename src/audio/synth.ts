/**
 * Procedural voice synthesis — Phase 12 (output half).
 *
 * The simulation never produces audio. It produces acoustic *parameters*, for
 * thousands of organisms, as six floats each. This module turns a handful of
 * those — the ones near wherever the user is listening — into actual sound.
 *
 * That split is the whole performance story: a hundred thousand organisms can
 * be calling and the audio graph still holds at most a dozen voices.
 *
 * Nothing here is generated from a file. Each voice is an oscillator plus a
 * noise source through a filter, and every knob on it comes straight from the
 * organism's own acoustic frame, so what you hear is what the organism's vocal
 * apparatus is actually doing.
 */
import { pitchToHz } from '../sim/acoustics/sound';

export interface VoiceFrame {
  id: number;
  x: number;
  y: number;
  distance: number;
  pitch: number;
  loudness: number;
  noisiness: number;
  timbre: number;
  slope: number;
  tremolo: number;
  external: boolean;
}

interface LiveVoice {
  osc: OscillatorNode;
  noise: AudioBufferSourceNode;
  oscGain: GainNode;
  noiseGain: GainNode;
  filter: BiquadFilterNode;
  tremoloOsc: OscillatorNode;
  tremoloGain: GainNode;
  out: GainNode;
  pan: StereoPannerNode;
  lastSeen: number;
}

/** Hard ceiling on simultaneous audible voices. */
const MAX_VOICES = 12;
/** Frames a voice can go unheard before it is torn down. */
const VOICE_TTL = 3;

export class VoiceSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private voices = new Map<number, LiveVoice>();
  private frame = 0;
  private listenerRadius = 700;

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /**
   * Must be called from a user gesture — browsers will not start an
   * AudioContext otherwise, and we do not try to work around that.
   */
  async start(): Promise<void> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = makeNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  stop(): void {
    for (const [id, v] of this.voices) {
      this.tearDown(v);
      this.voices.delete(id);
    }
    void this.ctx?.suspend();
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  setListenerRadius(r: number): void {
    this.listenerRadius = Math.max(1, r);
  }

  /**
   * Update the audio graph to match the current set of audible voices. Called
   * once per rendered frame; voices that persist keep their oscillator, which
   * is what makes a sustained call sound sustained rather than re-triggered.
   */
  update(frames: VoiceFrame[]): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || ctx.state !== 'running') return;
    this.frame++;
    const now = ctx.currentTime;
    const smooth = 0.05;

    const ranked = frames
      .slice()
      .sort((a, b) => b.loudness / (1 + b.distance) - a.loudness / (1 + a.distance))
      .slice(0, MAX_VOICES);

    for (const f of ranked) {
      let v = this.voices.get(f.id);
      if (!v) {
        if (this.voices.size >= MAX_VOICES) continue;
        v = this.spawn(ctx, master);
        this.voices.set(f.id, v);
      }
      v.lastSeen = this.frame;

      const hz = pitchToHz(f.pitch);
      // The sweep parameter is a glide over the coming frame, not an instant
      // jump — which is what makes a rising call audibly rise.
      const target = pitchToHz(Math.max(0, Math.min(1, f.pitch + f.slope * 0.25)));
      v.osc.frequency.setTargetAtTime(hz, now, smooth * 0.5);
      v.osc.frequency.linearRampToValueAtTime(target, now + 0.12);

      // Distance attenuation, matching the simulation's spreading term closely
      // enough that a distant call sounds distant.
      const attenuation = 1 / (1 + f.distance / 120);
      const level = Math.min(1, f.loudness) * attenuation;
      v.oscGain.gain.setTargetAtTime(level * (1 - f.noisiness) * 0.5, now, smooth);
      v.noiseGain.gain.setTargetAtTime(level * f.noisiness * 0.35, now, smooth);

      // Timbre opens the filter: a bright voice keeps its harmonics, a dark
      // one loses them. Distance also rolls off the top, as it does in air.
      const cutoff = 400 + f.timbre * 6000 * attenuation + hz;
      v.filter.frequency.setTargetAtTime(Math.min(16000, cutoff), now, smooth);

      v.tremoloOsc.frequency.setTargetAtTime(4 + f.tremolo * 26, now, smooth);
      v.tremoloGain.gain.setTargetAtTime(f.tremolo * 0.8, now, smooth);

      // Stereo position from where the source is relative to the listener.
      const pan = Math.max(-1, Math.min(1, f.x / this.listenerRadius));
      v.pan.pan.setTargetAtTime(pan, now, smooth);
      v.out.gain.setTargetAtTime(f.external ? 0.8 : 1, now, smooth);
    }

    for (const [id, v] of this.voices) {
      if (this.frame - v.lastSeen <= VOICE_TTL) continue;
      v.oscGain.gain.setTargetAtTime(0, now, 0.04);
      v.noiseGain.gain.setTargetAtTime(0, now, 0.04);
      const dying = v;
      window.setTimeout(() => this.tearDown(dying), 250);
      this.voices.delete(id);
    }
  }

  private spawn(ctx: AudioContext, master: GainNode): LiveVoice {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.2;

    // Amplitude modulation. The oscillator runs continuously and its depth is
    // what the organism's tremolo parameter controls.
    const tremoloOsc = ctx.createOscillator();
    tremoloOsc.frequency.value = 6;
    const tremoloGain = ctx.createGain();
    tremoloGain.gain.value = 0;

    const out = ctx.createGain();
    out.gain.value = 1;
    const pan = ctx.createStereoPanner();

    osc.connect(oscGain).connect(filter);
    noise.connect(noiseGain).connect(filter);
    filter.connect(out).connect(pan).connect(master);
    tremoloOsc.connect(tremoloGain).connect(out.gain);

    osc.start();
    noise.start();
    tremoloOsc.start();
    return { osc, noise, oscGain, noiseGain, filter, tremoloOsc, tremoloGain, out, pan, lastSeen: this.frame };
  }

  private tearDown(v: LiveVoice): void {
    try {
      v.osc.stop();
      v.noise.stop();
      v.tremoloOsc.stop();
    } catch {
      // Already stopped; nothing to do.
    }
    v.out.disconnect();
    v.pan.disconnect();
  }
}

/** One second of white noise, reused by every voice that needs a hiss. */
function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

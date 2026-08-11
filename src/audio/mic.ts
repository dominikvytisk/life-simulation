/**
 * Microphone input — Phase 12 (input half).
 *
 * A human makes a noise. This module measures that noise the same way the
 * simulation measures an organism's noise, and hands over six floats.
 *
 * What deliberately does not happen:
 *   - no speech recognition
 *   - no transcription
 *   - no keyword matching
 *   - no upload of anything, anywhere
 *
 * The audio never leaves the page. What crosses into the simulation is a
 * pitch, a loudness, a noisiness, a spectral tilt, a sweep and a tremolo depth,
 * and organisms receive them through exactly the same ear that hears each
 * other. Saying "food" into the microphone puts a particular acoustic shape
 * into the world; it does not put the concept of food into the world, and
 * whether that shape ever comes to precede anything is up to what the user
 * actually does next.
 */
import { Voice, hzToPitch } from '../sim/acoustics/sound';

const FFT_SIZE = 2048;
/** Below this RMS the microphone is treated as silent. */
const SILENCE_RMS = 0.012;

export interface MicFrame {
  /** VOICE_DIM acoustic frame, ready to hand to the simulation. */
  frame: number[];
  /** Raw level, for the meter. */
  rms: number;
  /** Estimated fundamental in Hz, or 0 when nothing is voiced. */
  hz: number;
  /** Waveform excerpt for the display. */
  wave: Float32Array;
  voiced: boolean;
}

export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private timeData = new Float32Array(FFT_SIZE);
  private freqData = new Float32Array(FFT_SIZE / 2);
  private lastPitch = 0;
  private smoothedPitch = 0;

  get active(): boolean {
    return this.analyser !== null;
  }

  /**
   * Ask for the microphone. Throws if the user declines, which is a normal
   * outcome and is surfaced rather than retried.
   */
  async start(): Promise<void> {
    if (this.analyser) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser exposes no microphone API.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.15;
    source.connect(this.analyser);
    // Deliberately not connected to the destination: no monitoring, no feedback.
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.lastPitch = 0;
    this.smoothedPitch = 0;
  }

  /** Measure the current input. Returns null when the microphone is not open. */
  read(): MicFrame | null {
    const analyser = this.analyser;
    const ctx = this.ctx;
    if (!analyser || !ctx) return null;

    analyser.getFloatTimeDomainData(this.timeData);
    analyser.getFloatFrequencyData(this.freqData);

    let sumSq = 0;
    for (let i = 0; i < this.timeData.length; i++) sumSq += this.timeData[i] * this.timeData[i];
    const rms = Math.sqrt(sumSq / this.timeData.length);
    const voiced = rms > SILENCE_RMS;

    const hz = voiced ? this.estimatePitch(ctx.sampleRate) : 0;
    const pitch = hz > 0 ? hzToPitch(hz) : this.smoothedPitch;

    // Spectral flatness separates a tone from a hiss: a flat spectrum is
    // noise, a peaky one is voiced. This is the same quantity the simulation
    // calls noisiness, measured the same way.
    const { flatness, centroid } = this.spectrum(ctx.sampleRate);

    const frame = new Array<number>(6).fill(0);
    frame[Voice.Pitch] = clamp01(pitch);
    // Compress hard: a microphone at conversational level should be an
    // ordinary sound in the world, not a thunderclap.
    frame[Voice.Loudness] = voiced ? Math.min(1, rms * 6) : 0;
    frame[Voice.Noisiness] = clamp01(flatness);
    frame[Voice.Timbre] = clamp01(centroid);
    // Sweep is measured from how the estimate has moved since the last read.
    frame[Voice.Slope] = voiced ? clamp(-1, 1, (pitch - this.smoothedPitch) * 6) : 0;
    frame[Voice.Tremolo] = 0;

    if (voiced) this.smoothedPitch = this.smoothedPitch * 0.7 + pitch * 0.3;

    return { frame, rms, hz, wave: this.timeData.slice(0, 256), voiced };
  }

  /**
   * Autocorrelation pitch estimate. Not the most accurate method available,
   * but it is cheap, runs on the main thread without a worklet, and is honest
   * about failing: when it cannot find a periodicity it reports none rather
   * than guessing.
   */
  private estimatePitch(sampleRate: number): number {
    const buf = this.timeData;
    const size = buf.length;
    const minLag = Math.floor(sampleRate / 900);
    const maxLag = Math.floor(sampleRate / 60);

    let bestLag = -1;
    let bestCorr = 0;
    let lastCorr = 1;
    for (let lag = minLag; lag < maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < size - lag; i++) corr += buf[i] * buf[i + lag];
      corr /= size - lag;
      if (corr > bestCorr && corr > lastCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
      lastCorr = corr;
    }
    if (bestLag < 0 || bestCorr < 1e-5) {
      // No clear periodicity — a hiss or a consonant. Hold the last pitch so
      // an unvoiced fragment does not slam the estimate to zero.
      return this.lastPitch;
    }
    this.lastPitch = sampleRate / bestLag;
    return this.lastPitch;
  }

  /** Spectral flatness (tone vs noise) and normalised centroid (dark vs bright). */
  private spectrum(sampleRate: number): { flatness: number; centroid: number } {
    const f = this.freqData;
    const n = f.length;
    let logSum = 0;
    let sum = 0;
    let weighted = 0;
    let used = 0;
    for (let i = 1; i < n; i++) {
      // getFloatFrequencyData returns dBFS; convert back to magnitude.
      const mag = Math.pow(10, f[i] / 20);
      if (!Number.isFinite(mag) || mag <= 1e-9) continue;
      logSum += Math.log(mag);
      sum += mag;
      weighted += mag * i;
      used++;
    }
    if (used === 0 || sum <= 0) return { flatness: 0.5, centroid: 0.3 };
    const geometric = Math.exp(logSum / used);
    const arithmetic = sum / used;
    const flatness = arithmetic > 0 ? geometric / arithmetic : 0;
    const centroidHz = (weighted / sum) * (sampleRate / 2 / n);
    return { flatness, centroid: Math.min(1, centroidHz / 4000) };
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(lo: number, hi: number, v: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

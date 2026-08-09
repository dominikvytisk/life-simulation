/**
 * Signal semantics discovery.
 *
 * The simulation never defines what a channel means. This module works it out
 * from data, the same way a field biologist would: measure what is going on
 * when a channel is emitted, and measure what listeners do when they hear it.
 *
 * Two correlation matrices, both running Pearson r over sampled organisms:
 *
 *   emission  r(emit[c],  context[k])  — what an emitter is experiencing
 *   response  r(heard[c], output[o])   — what a listener does about it
 *
 * Both are honest correlations and are reported as such. A channel that
 * correlates with nothing is reported as carrying no detectable meaning, which
 * is the usual and correct answer.
 */
import { SIGNAL_CHANNELS } from '../brain/brain';

export const CONTEXT_FEATURES = [
  'low energy',
  'injured',
  'predator near',
  'food here',
  'crowded',
  'kin near',
  'ready to mate',
  'attacking',
] as const;
export const CONTEXT_COUNT = CONTEXT_FEATURES.length;

/** Listener actions worth watching. Indices into the brain's output vector. */
export const RESPONSE_LABELS = ['move', 'turn', 'eat', 'attack', 'mate', 'flee-ish', 'echo'] as const;
export const RESPONSE_COUNT = RESPONSE_LABELS.length;

/** Samples decay so the picture tracks current behaviour, not ancient history. */
const DECAY = 0.9992;
const MIN_SAMPLES = 400;
/** Below this |r| a correlation is not worth reporting as meaning. */
export const MEANING_THRESHOLD = 0.12;

export interface SignalMeaning {
  channel: number;
  usage: number; // mean emission strength
  emitterContext: { label: string; r: number }[];
  listenerResponse: { label: string; r: number }[];
  confidence: number;
}

export class SignalAnalyzer {
  private n = 0;
  // Emission side.
  private sumE = new Float64Array(SIGNAL_CHANNELS);
  private sumE2 = new Float64Array(SIGNAL_CHANNELS);
  private sumC = new Float64Array(CONTEXT_COUNT);
  private sumC2 = new Float64Array(CONTEXT_COUNT);
  private sumEC = new Float64Array(SIGNAL_CHANNELS * CONTEXT_COUNT);
  // Response side.
  private sumH = new Float64Array(SIGNAL_CHANNELS);
  private sumH2 = new Float64Array(SIGNAL_CHANNELS);
  private sumR = new Float64Array(RESPONSE_COUNT);
  private sumR2 = new Float64Array(RESPONSE_COUNT);
  private sumHR = new Float64Array(SIGNAL_CHANNELS * RESPONSE_COUNT);

  /**
   * One observation: what this organism emitted, what was happening to it, what
   * it heard, and what it did. Emission and response are recorded from the same
   * organism in the same tick — a listener acts on what it hears within the
   * tick, so no cross-tick bookkeeping is needed.
   */
  observe(
    emit: Float32Array,
    emitOff: number,
    context: Float32Array,
    heard: Float32Array,
    response: Float32Array,
  ): void {
    this.n = this.n * DECAY + 1;
    for (let i = 0; i < this.sumE.length; i++) this.sumE[i] *= DECAY;
    for (let i = 0; i < this.sumE2.length; i++) this.sumE2[i] *= DECAY;
    for (let i = 0; i < this.sumC.length; i++) this.sumC[i] *= DECAY;
    for (let i = 0; i < this.sumC2.length; i++) this.sumC2[i] *= DECAY;
    for (let i = 0; i < this.sumEC.length; i++) this.sumEC[i] *= DECAY;
    for (let i = 0; i < this.sumH.length; i++) this.sumH[i] *= DECAY;
    for (let i = 0; i < this.sumH2.length; i++) this.sumH2[i] *= DECAY;
    for (let i = 0; i < this.sumR.length; i++) this.sumR[i] *= DECAY;
    for (let i = 0; i < this.sumR2.length; i++) this.sumR2[i] *= DECAY;
    for (let i = 0; i < this.sumHR.length; i++) this.sumHR[i] *= DECAY;

    for (let k = 0; k < CONTEXT_COUNT; k++) {
      this.sumC[k] += context[k];
      this.sumC2[k] += context[k] * context[k];
    }
    for (let o = 0; o < RESPONSE_COUNT; o++) {
      this.sumR[o] += response[o];
      this.sumR2[o] += response[o] * response[o];
    }
    for (let c = 0; c < SIGNAL_CHANNELS; c++) {
      const e = emit[emitOff + c];
      const h = heard[c];
      this.sumE[c] += e;
      this.sumE2[c] += e * e;
      this.sumH[c] += h;
      this.sumH2[c] += h * h;
      const ecBase = c * CONTEXT_COUNT;
      for (let k = 0; k < CONTEXT_COUNT; k++) this.sumEC[ecBase + k] += e * context[k];
      const hrBase = c * RESPONSE_COUNT;
      for (let o = 0; o < RESPONSE_COUNT; o++) this.sumHR[hrBase + o] += h * response[o];
    }
  }

  private static r(
    n: number,
    sx: number,
    sx2: number,
    sy: number,
    sy2: number,
    sxy: number,
  ): number {
    const cov = sxy / n - (sx / n) * (sy / n);
    const vx = sx2 / n - (sx / n) ** 2;
    const vy = sy2 / n - (sy / n) ** 2;
    if (vx <= 1e-9 || vy <= 1e-9) return 0;
    const r = cov / Math.sqrt(vx * vy);
    return Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : 0;
  }

  meanings(): SignalMeaning[] {
    const out: SignalMeaning[] = [];
    if (this.n < MIN_SAMPLES) return out;
    const n = this.n;

    for (let c = 0; c < SIGNAL_CHANNELS; c++) {
      const emitterContext: { label: string; r: number }[] = [];
      for (let k = 0; k < CONTEXT_COUNT; k++) {
        const r = SignalAnalyzer.r(
          n,
          this.sumE[c],
          this.sumE2[c],
          this.sumC[k],
          this.sumC2[k],
          this.sumEC[c * CONTEXT_COUNT + k],
        );
        if (Math.abs(r) >= MEANING_THRESHOLD) {
          emitterContext.push({ label: CONTEXT_FEATURES[k], r });
        }
      }
      const listenerResponse: { label: string; r: number }[] = [];
      for (let o = 0; o < RESPONSE_COUNT; o++) {
        const r = SignalAnalyzer.r(
          n,
          this.sumH[c],
          this.sumH2[c],
          this.sumR[o],
          this.sumR2[o],
          this.sumHR[c * RESPONSE_COUNT + o],
        );
        if (Math.abs(r) >= MEANING_THRESHOLD) {
          listenerResponse.push({ label: RESPONSE_LABELS[o], r });
        }
      }
      emitterContext.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
      listenerResponse.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

      const strongest = Math.max(
        emitterContext.length ? Math.abs(emitterContext[0].r) : 0,
        listenerResponse.length ? Math.abs(listenerResponse[0].r) : 0,
      );
      out.push({
        channel: c,
        usage: this.sumE[c] / n,
        emitterContext: emitterContext.slice(0, 3),
        listenerResponse: listenerResponse.slice(0, 3),
        confidence: strongest,
      });
    }
    return out;
  }

  get sampleCount(): number {
    return this.n;
  }

  reset(): void {
    this.n = 0;
    for (const a of [
      this.sumE,
      this.sumE2,
      this.sumC,
      this.sumC2,
      this.sumEC,
      this.sumH,
      this.sumH2,
      this.sumR,
      this.sumR2,
      this.sumHR,
    ]) {
      a.fill(0);
    }
  }
}

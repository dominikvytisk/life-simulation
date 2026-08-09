/**
 * Live neural network visualisation.
 *
 * Node fill is the current activation, edge colour is the weight's sign and
 * edge opacity its magnitude, so you can watch a decision propagate: a
 * predator entering the vision cone lights up NeighborProximity, which drives
 * whichever hidden units learned to care about it, which pushes Thrust or
 * Attack. The point is to make "why did it do that" answerable.
 *
 * Only the *expressed* part of the network is drawn — unused hidden units are
 * inert junk DNA and would just be noise.
 */
import { useMemo } from 'react';
import { INPUT_COUNT, INPUT_NAMES, OUTPUT_COUNT, OUTPUT_NAMES } from '../sim/brain/brain';
import { MAX_HIDDEN, MAX_CONTEXT } from '../sim/genome/phenotype';
import type { OrganismInspection } from '../sim/core/types';

const ROW = 13;
const PAD_TOP = 10;
const IN_X = 96;
const HID_X = 208;
const OUT_X = 300;
const WIDTH = 340;
const EDGE_LIMIT = 6; // strongest incoming edges drawn per unit

export function BrainView({ data }: { data: OrganismInspection }) {
  const hiddenSize = Math.min(data.hiddenSize, MAX_HIDDEN);
  const contextSize = Math.min(data.contextSize, MAX_CONTEXT);
  const height = PAD_TOP * 2 + Math.max(INPUT_COUNT, hiddenSize, OUTPUT_COUNT) * ROW;

  const inY = (i: number) => PAD_TOP + i * ROW + ROW / 2;
  const hidY = (h: number) =>
    PAD_TOP + ((INPUT_COUNT * ROW) / (hiddenSize + 1)) * (h + 1);
  const outY = (o: number) =>
    PAD_TOP + ((INPUT_COUNT * ROW) / (OUTPUT_COUNT + 1)) * (o + 1);

  // Keep only the strongest connections per unit; drawing all 384 input edges
  // turns the diagram into a grey rectangle.
  const edges1 = useMemo(() => {
    const list: { x1: number; y1: number; x2: number; y2: number; w: number }[] = [];
    const fanIn = INPUT_COUNT + MAX_CONTEXT;
    for (let h = 0; h < hiddenSize; h++) {
      const row = h * fanIn;
      const ranked: { i: number; w: number }[] = [];
      for (let i = 0; i < INPUT_COUNT; i++) ranked.push({ i, w: data.w1[row + i] ?? 0 });
      ranked.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
      for (const e of ranked.slice(0, EDGE_LIMIT)) {
        list.push({ x1: IN_X, y1: inY(e.i), x2: HID_X, y2: hidY(h), w: e.w });
      }
    }
    return list;
  }, [data.w1, hiddenSize]);

  const edges2 = useMemo(() => {
    const list: { x1: number; y1: number; x2: number; y2: number; w: number }[] = [];
    for (let o = 0; o < OUTPUT_COUNT; o++) {
      const row = o * MAX_HIDDEN;
      for (let h = 0; h < hiddenSize; h++) {
        const w = data.w2[row + h] ?? 0;
        if (Math.abs(w) < 0.12) continue;
        list.push({ x1: HID_X, y1: hidY(h), x2: OUT_X, y2: outY(o), w });
      }
    }
    return list;
  }, [data.w2, hiddenSize]);

  return (
    <div className="overflow-x-auto">
      <svg width={WIDTH} height={height} className="block">
        <g>
          {edges1.map((e, i) => (
            <line
              key={`a${i}`}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke={e.w > 0 ? '#4ee0c8' : '#ff6b5e'}
              strokeOpacity={Math.min(0.5, Math.abs(e.w) * 0.28)}
              strokeWidth={Math.min(1.6, 0.3 + Math.abs(e.w) * 0.35)}
            />
          ))}
          {edges2.map((e, i) => (
            <line
              key={`b${i}`}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke={e.w > 0 ? '#6aa8ff' : '#ff8a5e'}
              strokeOpacity={Math.min(0.65, Math.abs(e.w) * 0.4)}
              strokeWidth={Math.min(2, 0.3 + Math.abs(e.w) * 0.5)}
            />
          ))}
        </g>

        {/* Inputs */}
        {Array.from({ length: INPUT_COUNT }, (_, i) => {
          const a = data.brainInputs[i] ?? 0;
          return (
            <g key={`in${i}`}>
              <text
                x={IN_X - 8}
                y={inY(i) + 3}
                textAnchor="end"
                fontSize="8"
                fill={Math.abs(a) > 0.25 ? '#dbe4f0' : '#55607a'}
              >
                {INPUT_NAMES[i]}
              </text>
              <circle cx={IN_X} cy={inY(i)} r={3.4} fill={actColor(a)} stroke="#1c2432" />
            </g>
          );
        })}

        {/* Hidden */}
        {Array.from({ length: hiddenSize }, (_, h) => (
          <circle
            key={`h${h}`}
            cx={HID_X}
            cy={hidY(h)}
            r={5}
            fill={actColor(data.brainHidden[h] ?? 0)}
            stroke="#2a3446"
          />
        ))}

        {/* Outputs */}
        {Array.from({ length: OUTPUT_COUNT }, (_, o) => {
          const a = data.brainOutputs[o] ?? 0;
          return (
            <g key={`o${o}`}>
              <circle cx={OUT_X} cy={outY(o)} r={4.5} fill={actColor(a)} stroke="#2a3446" />
              <text
                x={OUT_X + 9}
                y={outY(o) + 3}
                fontSize="8"
                fill={Math.abs(a) > 0.25 ? '#dbe4f0' : '#55607a'}
              >
                {OUTPUT_NAMES[o]}
              </text>
            </g>
          );
        })}

        <text x={IN_X} y={height - 1} fontSize="7" fill="#55607a" textAnchor="middle">
          SENSORS
        </text>
        <text x={HID_X} y={height - 1} fontSize="7" fill="#55607a" textAnchor="middle">
          HIDDEN ×{hiddenSize}
        </text>
        <text x={OUT_X} y={height - 1} fontSize="7" fill="#55607a" textAnchor="middle">
          ACTIONS
        </text>
      </svg>

      {contextSize > 0 && (
        <div className="mt-2">
          <div className="label-xs mb-1">Recurrent memory ×{contextSize}</div>
          <div className="flex gap-1">
            {data.brainContext.slice(0, contextSize).map((v, i) => (
              <div
                key={i}
                title={`context ${i}: ${v.toFixed(3)}`}
                className="h-4 flex-1 border border-edge"
                style={{ background: actColor(v) }}
              />
            ))}
          </div>
          <p className="mt-1 text-[9px] leading-snug text-ink-dim">
            State carried from the previous tick. This is what lets the organism keep reacting to
            something it can no longer see.
          </p>
        </div>
      )}
    </div>
  );
}

/** Blue for negative, dark for zero, teal for positive — sign is readable at a glance. */
function actColor(a: number): string {
  const v = Math.max(-1, Math.min(1, a));
  if (v >= 0) {
    const t = v;
    return `rgb(${Math.round(12 + t * 66)}, ${Math.round(20 + t * 204)}, ${Math.round(28 + t * 172)})`;
  }
  const t = -v;
  return `rgb(${Math.round(12 + t * 243)}, ${Math.round(20 + t * 87)}, ${Math.round(28 + t * 66)})`;
}

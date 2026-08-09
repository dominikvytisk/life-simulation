/**
 * Minimal canvas line chart. No charting library — the requirement is a few
 * hundred points redrawn a couple of times a second, and a dependency would
 * cost more than the 80 lines it saves.
 *
 * Charts are drawn on a shared time axis so series can be compared by eye;
 * that is the whole point of putting predator rate next to population.
 */
import { useEffect, useRef } from 'react';

export interface Series {
  label: string;
  data: Float32Array;
  color: string;
  /** Draw on the right-hand scale instead of the left. */
  secondary?: boolean;
}

export function Chart({
  ticks,
  series,
  height = 96,
  zeroBased = true,
}: {
  ticks: Float64Array;
  series: Series[];
  height?: number;
  zeroBased?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const draw = () => {
      const w = wrap.clientWidth;
      canvas.width = Math.max(1, w * dpr);
      canvas.height = height * dpr;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, height);

      const n = ticks.length;
      if (n < 2) {
        ctx.fillStyle = '#55607a';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText('collecting…', 6, height / 2);
        return;
      }

      // Independent scales for primary and secondary groups.
      const scaleFor = (secondary: boolean) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const s of series) {
          if (!!s.secondary !== secondary) continue;
          for (let i = 0; i < n; i++) {
            const v = s.data[i];
            if (!Number.isFinite(v)) continue;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        if (!Number.isFinite(lo)) return { lo: 0, hi: 1 };
        if (zeroBased && lo > 0) lo = 0;
        if (hi === lo) hi = lo + 1;
        return { lo, hi: hi + (hi - lo) * 0.08 };
      };
      const primary = scaleFor(false);
      const secondary = scaleFor(true);

      // Gridlines.
      ctx.strokeStyle = 'rgba(120,150,190,0.08)';
      ctx.lineWidth = 1;
      for (let g = 0; g <= 4; g++) {
        const y = Math.round((g / 4) * (height - 12)) + 6 + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      for (const s of series) {
        const sc = s.secondary ? secondary : primary;
        const range = sc.hi - sc.lo || 1;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * w;
          const y = height - 6 - ((s.data[i] - sc.lo) / range) * (height - 12);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.secondary ? 1 : 1.5;
        if (s.secondary) ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Faint fill under the primary series to give it visual weight.
        if (!s.secondary && series.filter((x) => !x.secondary).length === 1) {
          ctx.lineTo(w, height);
          ctx.lineTo(0, height);
          ctx.closePath();
          const grad = ctx.createLinearGradient(0, 0, 0, height);
          grad.addColorStop(0, `${s.color}33`);
          grad.addColorStop(1, `${s.color}00`);
          ctx.fillStyle = grad;
          ctx.fill();
        }
      }

      // Max label for the primary scale.
      ctx.fillStyle = '#55607a';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(formatTick(primary.hi), 3, 10);
      ctx.fillText(formatTick(primary.lo), 3, height - 2);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [ticks, series, height, zeroBased]);

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={ref} className="w-full block" />
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1 text-[9px] text-ink-dim">
            <span
              className="inline-block h-[2px] w-3"
              style={{ background: s.color, opacity: s.secondary ? 0.7 : 1 }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  if (Math.abs(v) >= 10) return v.toFixed(0);
  return v.toFixed(2);
}

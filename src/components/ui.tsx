/** Small shared primitives. Kept deliberately plain — the interesting visuals
 * belong to the world view and the charts, not the chrome. */
import type { ReactNode } from 'react';

export function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="border-b border-edge/70 px-3 py-3">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="label-xs">{title}</h3>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  unit,
  tone = 'default',
  title,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: 'default' | 'accent' | 'warn' | 'danger' | 'life';
  title?: string;
}) {
  const toneClass = {
    default: 'text-ink',
    accent: 'text-accent',
    warn: 'text-warn',
    danger: 'text-danger',
    life: 'text-life',
  }[tone];
  return (
    <div title={title} className="min-w-0">
      <div className="label-xs truncate">{label}</div>
      <div className={`truncate text-[15px] leading-tight tabular-nums ${toneClass}`}>
        {value}
        {unit && <span className="ml-0.5 text-[10px] text-ink-dim">{unit}</span>}
      </div>
    </div>
  );
}

/** Horizontal magnitude bar. Used everywhere a 0..1 gene or trait is shown. */
export function Bar({
  value,
  color = 'var(--color-accent)',
  height = 6,
  background = '#141b26',
}: {
  value: number;
  color?: string;
  height?: number;
  background?: string;
}) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div style={{ height, background }} className="w-full overflow-hidden rounded-[1px]">
      <div style={{ width: `${v * 100}%`, height, background: color }} />
    </div>
  );
}

export function TraitRow({
  label,
  value,
  color,
  display,
}: {
  label: string;
  value: number;
  color?: string;
  display?: string;
}) {
  return (
    <div className="grid grid-cols-[92px_1fr_42px] items-center gap-2 py-[3px]">
      <span className="truncate text-[10px] text-ink-dim">{label}</span>
      <Bar value={value} color={color} />
      <span className="text-right text-[10px] tabular-nums text-ink-dim">
        {display ?? value.toFixed(2)}
      </span>
    </div>
  );
}

export function Button({
  children,
  onClick,
  active,
  disabled,
  tone = 'default',
  title,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'accent' | 'danger';
  title?: string;
  className?: string;
}) {
  const toneRing =
    tone === 'danger'
      ? 'hover:border-danger/60 hover:text-danger'
      : tone === 'accent'
        ? 'hover:border-accent/60 hover:text-accent'
        : 'hover:border-edge-2 hover:text-ink';
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`border px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? 'border-accent/70 bg-accent/10 text-accent'
          : `border-edge bg-panel-2 text-ink-dim ${toneRing}`
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function hueColor(h: number, s = 60, l = 58): string {
  return `hsl(${(h * 360).toFixed(0)} ${s}% ${l}%)`;
}

export function fmt(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(digits);
}

import { useMemo } from 'react';
import { useStore } from '../app/store';
import { Section, TraitRow, fmt, hueColor } from './ui';
import { LOCUS_LABELS, LOCUS_NAMES } from '../sim/genome/loci';
import type { SpeciesSummary } from '../sim/core/types';

/**
 * Living species, plus the phylogeny they form. The tree is built from
 * ancestorId links recorded at the moment each species diverged, so it is a
 * real lineage record rather than a similarity clustering computed after the
 * fact.
 */
export function SpeciesPanel() {
  const species = useStore((s) => s.species);
  const extinct = useStore((s) => s.extinct);

  const tree = useMemo(() => buildTree(species, extinct), [species, extinct]);

  if (species.length === 0) {
    return <div className="p-4 text-[11px] text-ink-dim">no living species</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <Section title={`Living species (${species.length})`}>
        <div className="space-y-2">
          {species.map((s) => (
            <SpeciesCard key={s.id} s={s} />
          ))}
        </div>
      </Section>

      <Section title="Phylogeny">
        <div className="text-[10px] leading-relaxed">
          {tree.map((node) => (
            <TreeNode key={node.id} node={node} depth={0} />
          ))}
        </div>
        <p className="mt-2 text-[9px] text-ink-dim">
          A branch appears when an offspring's genome drifts past the speciation threshold from its
          parent species' reference genome.
        </p>
      </Section>
    </div>
  );
}

function SpeciesCard({ s }: { s: SpeciesSummary }) {
  // Show the loci that differ most from the neutral midpoint — the traits that
  // actually characterise this species rather than all 28 rows.
  const notable = useMemo(() => {
    return s.traits
      .map((v, i) => ({ i, v, dev: Math.abs(v - 0.5) }))
      .sort((a, b) => b.dev - a.dev)
      .slice(0, 6);
  }, [s.traits]);

  return (
    <div className="border border-edge bg-panel-2 p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: hueColor(s.hue) }}
        />
        <span className="text-[12px] text-ink">{s.name}</span>
        <span className="text-[9px] text-ink-dim">#{s.id}</span>
        <span className="ml-auto tabular-nums text-[12px] text-life">{fmt(s.population)}</span>
      </div>
      <div className="mb-1.5 grid grid-cols-4 gap-1 text-[9px] text-ink-dim">
        <span>peak {fmt(s.peakPopulation)}</span>
        <span>born {fmt(s.totalBorn)}</span>
        <span>gen {s.generationOrigin}</span>
        <span>t{fmt(s.originTick)}</span>
      </div>
      <div className="mb-1.5 flex flex-wrap gap-x-3 text-[9px]">
        <span className="text-ink-dim">
          size <span className="text-ink">{s.avgSize.toFixed(1)}</span>
        </span>
        <span className="text-ink-dim">
          speed <span className="text-ink">{s.avgSpeed.toFixed(1)}</span>
        </span>
        <span className="text-ink-dim">
          brain <span className="text-ink">{s.avgBrain.toFixed(1)}</span>
        </span>
        <span className="text-ink-dim">
          memory <span className="text-ink">{s.avgMemory.toFixed(1)}</span>
        </span>
        <span className="text-ink-dim">
          gut{' '}
          <span style={{ color: s.carnivory > 0.5 ? 'var(--color-danger)' : 'var(--color-life)' }}>
            {s.carnivory > 0.6
              ? 'meat'
              : s.carnivory > 0.4
                ? 'mixed'
                : 'plant'}
          </span>
        </span>
      </div>

      {s.niche && <NicheCard niche={s.niche} />}
      {notable.map((t) => (
        <TraitRow
          key={t.i}
          label={LOCUS_LABELS[LOCUS_NAMES[t.i]] ?? LOCUS_NAMES[t.i]}
          value={t.v}
          color={hueColor(s.hue, 55, 52)}
        />
      ))}
    </div>
  );
}

/**
 * The niche is measured, not declared. Every line is a running average over
 * where members of this species actually were and what they actually ate — so a
 * species that changes habitat changes its description.
 */
function NicheCard({ niche }: { niche: NonNullable<SpeciesSummary['niche']> }) {
  const meat = niche.dietMix.carrion + niche.dietMix.predation;
  return (
    <div className="mb-1.5 border-l-2 border-accent/30 pl-2">
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px]">
        <NicheRow k="habitat" v={niche.habitat} dim={niche.habitatConfidence < 0.5} />
        <NicheRow k="activity" v={niche.activity} />
        <NicheRow k="diet" v={niche.diet} />
        <NicheRow k="grouping" v={niche.grouping} />
        <NicheRow k="signals" v={niche.communication} />
        <NicheRow k="memory" v={niche.memoryUse} />
      </div>
      <div className="mt-0.5 text-[9px] text-ink-dim">
        temp {niche.temperatureRange[0].toFixed(2)}–{niche.temperatureRange[1].toFixed(2)}
        {meat > 0.02 && ` · ${(meat * 100).toFixed(0)}% of intake is meat`}
        {niche.waterDepth > 0.01 && ' · often in water'}
      </div>
      <div className="mt-0.5 text-[9px] text-ink-dim/50">
        inferred from {niche.samples} observations
      </div>
    </div>
  );
}

function NicheRow({ k, v, dim }: { k: string; v: string; dim?: boolean }) {
  return (
    <div className="flex justify-between gap-1">
      <span className="text-ink-dim/70">{k}</span>
      <span className={dim ? 'text-ink-dim' : 'text-ink'}>{v}</span>
    </div>
  );
}

interface TreeNodeData {
  id: number;
  name: string;
  population: number;
  extinct: boolean;
  hue: number;
  originTick: number;
  children: TreeNodeData[];
}

function buildTree(living: SpeciesSummary[], extinct: SpeciesSummary[]): TreeNodeData[] {
  const all = [...living, ...extinct];
  const byId = new Map<number, TreeNodeData>();
  for (const s of all) {
    byId.set(s.id, {
      id: s.id,
      name: s.name,
      population: s.population,
      extinct: s.extinctTick >= 0,
      hue: s.hue,
      originTick: s.originTick,
      children: [],
    });
  }
  const roots: TreeNodeData[] = [];
  for (const s of all) {
    const node = byId.get(s.id)!;
    const parent = byId.get(s.ancestorId);
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: TreeNodeData[]) => {
    nodes.sort((a, b) => a.originTick - b.originTick);
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

function TreeNode({ node, depth }: { node: TreeNodeData; depth: number }) {
  // Deep phylogenies get long; cap the indentation so the panel stays readable.
  const indent = Math.min(depth, 8) * 10;
  return (
    <>
      <div className="flex items-center gap-1.5 py-[1px]" style={{ paddingLeft: indent }}>
        {depth > 0 && <span className="text-ink-dim/40">└</span>}
        <span
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: hueColor(node.hue), opacity: node.extinct ? 0.3 : 1 }}
        />
        <span className={node.extinct ? 'text-ink-dim/50 line-through' : 'text-ink'}>
          {node.name}
        </span>
        {!node.extinct && <span className="text-life">{node.population}</span>}
        {node.extinct && <span className="text-danger/60">†</span>}
      </div>
      {node.children.map((c) => (
        <TreeNode key={c.id} node={c} depth={depth + 1} />
      ))}
    </>
  );
}

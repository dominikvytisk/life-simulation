# LIFE — Digital Evolution Observatory

[![Live simulation](https://img.shields.io/badge/demo-live-4ee0c8?style=flat-square&labelColor=0a0e16)](https://dominikvytisk.github.io/life-simulation/)
[![Deploy](https://img.shields.io/github/actions/workflow/status/dominikvytisk/life-simulation/deploy.yml?style=flat-square&labelColor=0a0e16&label=build%20%26%20tests)](https://github.com/dominikvytisk/life-simulation/actions/workflows/deploy.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&labelColor=0a0e16)](tsconfig.app.json)

**An artificial life simulation that runs in your browser.** Thousands of organisms evolve genomes,
bodies, senses, recurrent neural networks, episodic memory, a vocal apparatus and an ear — and none
of their behaviour is scripted. No sound in this world has a meaning attached to it by anyone.

[**▶ Open the live simulation**](https://dominikvytisk.github.io/life-simulation/) · [How it works](#how-it-works) · [What emerges](#emergent-behaviour-to-watch-for) · [Measured results](#measured-behaviour)

![LIFE artificial life simulation running in a browser. The centre panel shows a procedurally generated island covered in thousands of evolved organisms; the right-hand inspector shows a single organism's vitals, life history, learning and culture statistics, episodic memory slots, its vocal and auditory range, and its live neural network with activations.](preview.png)

Foraging, predation, scavenging, grouping and signalling are not features in this codebase. They are
outcomes. The simulation supplies an energy economy, a sensory model, a mutable genome and a mutable
brain, and lets selection decide the rest.

The design rule the whole project follows:

> Do not script interesting behaviour. Build an environment and an evolutionary system rich enough
> that interesting behaviour has somewhere to come from.

There is no `if (predator) flee`. There is no herbivore class, no carnivore class, no flocking rule.
There is an energy economy, a sensory model, a mutable genome and a mutable brain — and whatever
survives, survives.

## What is in it

- **Evolvable genomes** — 49 loci controlling body plan, metabolism, senses, brain width, memory,
  vocal and auditory anatomy, *how the organism learns*, and the mutation rate itself
- **A neural network per organism** — recurrent, 79 sensory inputs, 18 action outputs, with evolved
  hidden width and evolved recurrent memory
- **Lifetime learning** — reward-modulated Hebbian plasticity, kept strictly separate from the
  germline, so nothing learned is ever inherited
- **A private world model per organism** — each one learns to predict its own next internal state
  and its own next stretch of reward, from nothing but what its own senses produced. Nothing is
  shared, nothing is trained across the population, and an organism that expresses zero prediction
  carries no model and pays nothing
- **Prediction error, kept separate from reward** — being wrong about what the next moment looks
  like and being wrong about whether it goes well are tracked as different failures
- **Curiosity from learning progress, not from surprise** — intrinsic value requires both that a
  situation is unfamiliar *and* that the organism has been getting better at predicting it, so
  nothing is paid for staring at noise
- **Internal simulation and shallow planning** — an organism can imagine a few variations on what
  its network just proposed, roll each forward through its own model, and keep the one it expects to
  go best. Depth and breadth are genetic, start at zero, and cost energy per imagined step
- **Evolvable learning strategy** — learning rate, forgetting rate, prediction horizon, planning
  budget, curiosity, consolidation and a meta-rate that lets recent surprise change the learning rate
  itself. Fast learners, slow learners, explorers and exploiters are statistical outcomes of these,
  not classes
- **Episodic memory with context and consolidation** — organisms remember where good and bad things
  happened *and the internal state they happened in*, strengthen what proves useful, and replay
  recent experience while resting. All of it at a real upkeep cost many lineages decline to pay
- **Delayed consequences** — some vegetation carries a slow poison correlated with a visible but
  unlabelled property of the plant. The energy arrives now, the damage arrives hundreds of ticks
  later, and the connection has to be learned or evolved around
- **Socially transmitted belief** — a listener that recognises a sound can form a place-memory at its
  source from its own learned association, so knowledge can reach an organism that never lived it.
  It is frequently wrong
- **Emergent acoustic communication** — a genetically determined vocal tract and ear, sound that
  propagates through real physics, and an observer that measures what the resulting calls correlate
  with rather than deciding what they mean
- **Human interaction** — speak into a microphone and organisms hear the acoustic properties of your
  voice through the same ear they hear each other with. No speech recognition, no keywords, no audio
  leaving the page
- **Kin recognition and altruism** — Mendelian kin markers plus a plain energy-transfer action, the
  ingredients kin selection needs
- **Social learning and culture** — imitation copies learned weights but never genes, adding a third
  inheritance channel alongside genetics and individual experience
- **Speciation and extinction** — a real phylogenetic tree built from recorded divergences, with
  permanent extinction records in a Museum of Life
- **Ecological niche inference** — habitat, activity cycle and diet derived from telemetry, never
  assigned
- **Deterministic and forkable** — the same seed reproduces a run exactly, and a fork continues its
  parent bit for bit, which is what makes controlled evolutionary experiments possible
- **WebGPU rendering** — instanced, two draw calls per frame, with an automatic Canvas2D fallback

---

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # simulation invariants, determinism, genetics, neural net
npm run build
```

WebGPU is used when available; otherwise it falls back to Canvas2D automatically (the badge in the
top-right tells you which).

---

## Architecture

```text
React UI (main thread)
   │  zustand — panel state only, updated a few times per second
   │
SimClient ── postMessage ──► Web Worker
   │                            │
   │                        Simulation
   │                         ├── World        terrain, climate, vegetation, signal fields
   │                         ├── Population   structure-of-arrays, slot recycling
   │                         ├── SpatialHash  O(N) counting-sort rebuild each tick
   │                         ├── Brain        recurrent MLP per organism
   │                         ├── Evolution    crossover, mutation, speciation
   │                         └── Events       world events, event log, history
   │
   └──► WebGPU renderer — 2 draw calls per frame, instanced
```

Two rules hold the performance line:

1. **The simulation never touches React.** It lives in a worker and communicates through transferred
   ArrayBuffers. Position data never enters the React tree.
2. **The render path does no per-organism JavaScript.** The worker packs a dense snapshot; the GPU
   reads it as an instance buffer directly.

Snapshot buffers ping-pong between the worker and the main thread — the worker transfers one over,
the renderer draws from it, and it is handed back on the next frame. Steady-state allocation is zero.

### Directory map

| Path | What lives there |
| --- | --- |
| `src/sim/core` | RNG, config, spatial hash, cross-boundary types |
| `src/sim/world` | Procedural generation, environment fields, map painter |
| `src/sim/genome` | Gene loci, genotype → phenotype expression |
| `src/sim/brain` | Network layout, forward pass, Hebbian plasticity, imitation |
| `src/sim/memory` | Episodic place memory: encoding, context-gated recall, forgetting, consolidation |
| `src/sim/cognition` | The world model, internal simulation and planning, offline replay |
| `src/sim/evolution` | Crossover, mutation, kin-tag inheritance, founder genomes |
| `src/sim/organisms` | The SoA population store |
| `src/sim/species` | Speciation, phylogeny, extinction records |
| `src/sim/acoustics` | Sound representation, propagation, ear, auditory associative memory |
| `src/sim/analysis` | Niche inference, call statistics, culture, chronicle |
| `src/sim/events` | World events, event log |
| `src/gpu` | WebGPU + Canvas2D renderers, WGSL shaders |
| `src/workers` | Simulation worker, headless experiment worker, protocol |
| `src/components` | Panels, charts, inspector, brain view |
| `src/experiments` | Preset worlds, hypotheses, experiment comparison |
| `src/audio` | Procedural Web Audio synthesis, microphone feature extraction |
| `src/analytics` | Time-series ring buffers |
| `src/persistence` | IndexedDB save/load, file export/import |

---

## How it works

### Genome

49 loci, each a float in `[0,1]`. The genome is uniform and meaningless on its own — `phenotype.ts`
is the only place that decides what a gene *does*. That keeps mutation, crossover and genetic
distance generic.

Eight of those loci do not describe the organism at all. They describe **how it learns**: the rate
its internal model is fitted at, how fast an unrefreshed expectation is abandoned, how much recent
surprise is allowed to change that rate, how much weight the unexplained carries, how far ahead and
how widely it can imagine, how much it replays while resting, and how fast it clears a toxin. Two
organisms with identical bodies and identical brains but different values here will, in the same
world, end up behaving differently — because they will have learned different things.

Almost every trait is **paid for**. Bigger eyes cost upkeep. Armor costs mass, and mass costs speed.
A wider brain costs energy every tick. A meat-specialised gut *loses* the ability to digest plants
(`plantEff = (1-d)^0.62`, `meatEff = d^0.62` — a generalist is strictly worse at both than a
specialist is at its own food). Without costs, evolution maximises everything and the ecosystem
collapses into a single strategy.

Note what is **not** in the genome: no diet type, no species label, no behaviour flag, no role, and
no intelligence score. Nothing unlocks at a generation threshold. Every cognitive capability is
available from tick zero and costs upkeep from tick zero, which is why founders are drawn with
almost none of it — handing generation 0 a large model would not produce thinking animals, it would
produce a population taxed for organs it cannot yet use.

### Neural network

Per organism: `71 inputs + ≤6 recurrent context → ≤14 hidden (tanh) → 18 outputs + next context`,
stored as a flat slice of one big `Float32Array`.

The outputs are: thrust, turn, eat, attack, mate, rest, sprint, imitate, share, two pheromone
deposits, and the seven knobs on the vocal apparatus. Note what is *not* there — no "flee", no
"follow", no "call for help", no "defend offspring". Fleeing is thrust in a direction; following is thrust toward a sensed neighbour;
provisioning is the share output aimed at something small and closely related. Those are things an
organism can do, not things it can be told to do.

The recurrent context is what gives an organism state between ticks — it can stay alarmed, keep
fleeing something it can no longer see, hold a search pattern. It was not built as a "memory
feature"; it is a loop that evolution may use or switch off (`BrainContext` can evolve to zero).

**Germline and soma are separate.** Inherited weights live in `brain`; lifetime Hebbian learning
writes into a separate `plastic` buffer applied only to the output layer. Learned changes are never
inherited. The reward signal is not a fitness score handed down by the designer — it is the
organism's own change in wellbeing, energy gained minus pain felt.

Hidden units beyond the expressed width still carry weights. They are inert junk DNA that a
structural mutation can switch back on.

### Senses

Egocentric, normalised, and deliberately raw. Vegetation gradient, elevation gradient, nearest two
organisms as body-relative vectors, their relative size, genetic similarity (kin recognition), local
population density, the *mean heading of neighbours*, temperature stress, water depth, light,
pheromone concentration and its gradient, pain, reward — and, from the ear, the physical properties
of whatever is currently in the air plus the last few sounds that finished.

Six more are interoception aimed at the learning machinery rather than at the body: how badly the
organism's own model has been failing, how confident it is, whether it has been getting better
lately, how unfamiliar the situation is, what its curiosity currently amounts to, and how much
better deliberating made its last decision look. Two more are a visible property of the local
vegetation and how much of something the organism cannot name has built up inside it.

Nothing tells the brain what to do about any of them. A lineage that evolves zero weights onto all
eight behaves exactly as it did before any of this existed, and many do.

Between the world and an organism there is now an **instrument**. Distal senses — gradients,
neighbour bearings, local vegetation, the flora trait — are degraded by noise scaled by
`(1 - visionAcuity)`, so a cheap eye reports roughly and a sharp one nearly exactly. Nothing ever
receives the number the world actually holds. That noise is hashed from `(slot, tick, channel)`
rather than drawn from the simulation RNG, so it cannot make the run's randomness depend on how many
organisms happen to be alive.

Some of those are the exact ingredients a flocking rule would need. No flocking rule is provided.
Others are the exact ingredients a conversation would need. No conversation system is provided
either. And the world model is handed the exact ingredients a planner would need, with no goal
attached to any of them.

### Energy economy

Gains come from grazing vegetation, eating carrion, and tearing flesh off something you bite.
Losses come from basal upkeep (a function of body plan), movement (`mass^0.75 · speed^1.5`), attacks,
broadcasting signals, thermal stress outside the evolved tolerance band, drowning, and reproduction.

Predation emerges from this arithmetic and nothing else. Attacking costs energy up front; the flesh
you tear off is only worth something if your gut can digest meat. A plant-gutted lineage that
evolves aggression simply loses energy and dies out.

When an organism dies it does not vanish — its energy becomes carrion at that location, which is the
resource that makes scavenging a viable niche. Carrion is stored in energy units and
`carrionEnergyDensity` is a feeding *rate*: how much of a corpse one bite can process. (It was
originally stored as biomass, deposited divided by that constant and eaten multiplied by it — so the
constant cancelled out of the model completely and the dial did nothing. There is a regression test
for that now.)

### Memory

Each organism holds up to eight episodic place-memories: where something notably good or bad
happened, how good or bad, and a confidence that decays. It senses the remembered valence of its
current position, the direction of its best and worst remembered places, and how loaded its memory
is — six sensory inputs, nothing more. There is no "return to remembered food" behaviour anywhere.

Each memory also carries a **context fingerprint** — the first few units of the organism's own
recurrent state at the moment of encoding. Recall is weighted by how closely the current state
resembles it, so a memory is not simply a fact about a patch of ground but a fact about that ground
*as met in a particular kind of moment*. An organism that encounters two superficially different
things its brain happens to represent alike will recall one when it meets the other, which is
generalisation arrived at without anything in the code knowing what either thing was. It is also how
generalisation goes wrong, and nothing prevents that. An organism whose `BrainContext` evolved to
zero has no such state and no gating at all.

Memories that keep being present when something significant happens gain **importance**: they decay
more slowly and are the last to be displaced. During deep rest an organism can **consolidate** —
strengthening what has proven useful, releasing what has not, and replaying stored transitions into
its world model. Total held confidence does not rise, so consolidating is a decision about *which*
memories to keep, not a way to keep more of them.

Capacity, forgetting rate and consolidation are all genetic and all cost upkeep every tick, so memory
has to earn its keep. Many lineages evolve *zero* slots, which is a legitimate answer to a world
where remembering costs more than it returns.

### The world model

Each organism carries a small private predictive model:

```text
[ its own current internal state , the action it took ]  ->  [ its next internal state , reward ]
```

The "internal state" is not a description of the world written anywhere in the code. It is the
organism's own hidden layer — whatever its evolved brain compresses its senses into. Nobody labels
those units, nothing guarantees they mean anything, and what they encode differs between lineages.
The model learns to predict the organism's *own representation*, so as the representation evolves, so
does what there is to predict.

It is a linear map fitted by normalised least mean squares: a few hundred multiply-adds, learning
online from single samples, unable to diverge, and small enough that carrying one is a plausible
metabolic cost. It is a weak model on purpose. An organism that predicts well here has done so
because its *brain* found a representation that happens to be linearly predictable, which is a real
thing for evolution to discover.

The model runs at a quarter of the brain's rate, staggered by slot. One model step therefore spans
several decisions — which is both what makes it affordable at population scale and what makes a
consequence landing several ticks after its cause something a one-step predictor can get hold of.

Four quantities come out of it, and they are deliberately not the same quantity:

| | |
| --- | --- |
| **Surprise** | how wrong the last expectation was, split into latent error and reward error |
| **Confidence** | `1 / (1 + long-run surprise)` |
| **Novelty** | how little the model has been exposed to the features it is currently acting on |
| **Learning progress** | long-run surprise minus recent surprise, *minus how much that difference bounces around on its own* |

That last correction matters more than it looks and a failing test is what found it. Without it, a
permanently unpredictable stream still produces positive progress regularly — the short average
fluctuates around the long one and every downward fluctuation reads as improvement. An organism paid
for that would be paid for sitting in front of noise, which is exactly what learning progress exists
to rule out. So an improvement only counts once it exceeds the standard deviation the short average
would have under pure chance: the same standard the experiment runner applies to a difference between
arms, applied here to a difference across time.

Intrinsic value is `curiosity × learning progress × novelty`. It requires *both* that the situation
is unfamiliar and that the organism has been improving — novelty alone would pay an animal to stare
at static. It enters the Hebbian learning signal as a separate term from reward, weighted by a gene
that is usually near zero and by a global gain well under one, so nothing can live on curiosity.

### Imagination and planning

Before acting, an organism with a non-zero prediction horizon *and* a non-zero planning budget can
take the action its network just proposed, invent a few variations on it, roll each forward through
its own model, and keep whichever one the model expects to go best. With either gene at zero — which
is what almost every founder has — none of it runs and the organism acts on its raw network output
exactly as before.

Three things are worth being explicit about.

There is no planning *algorithm* in the sense of a rule that knows what to do about anything. Nothing
in it can tell a predator from a plant. It compares numbers its owner's model produced and picks the
larger, and if that model is wrong — which early in every life it is — the plan is worse than no plan
at all. **Deliberating badly is a real way to die here.**

The candidates are perturbations of the brain's own proposal, not samples from the whole action
space: an organism considers doing roughly what it was already going to do, slightly differently. How
slightly is set by the *same* gene that weights the unexplained, so an incurious animal considers
small variations on its habit and a curious one entertains stranger ideas.

A candidate is scored on predicted reward **plus** how little the model knows about it, weighted by
curiosity. That single line is where exploration and exploitation come from. Nothing declares a mode.
An organism with zero curiosity maximises expected reward and repeats what works; one with high
curiosity will take an action it expects to go worse in order to find out what happens. Which of them
survives is a question about the world.

Deliberation is charged per imagined step, and the machinery costs upkeep whether used or not. The
plan is stored as a departure from instinct rather than as an action, so it survives the ticks
between deliberations while the senses keep changing underneath it.

### Delayed consequences

Some vegetation carries a slow poison. How much is a sharp function of `flora` — a visible, smoothly
varying property of the growth that has no consequences of its own — times a component that
appearance does *not* predict. Eating pays energy immediately and adds to a toxin load that damages
health hundreds of ticks later, once it passes a harmless threshold.

Nothing announces this. A reflex cannot connect the two events; a place-memory or a model might. A
lineage can answer it by learning which growth carries it or by evolving to clear it faster — two
entirely different solutions to one problem, and nothing prefers either. A lineage can also simply
not answer it.

A `toxicShift` world event moves which appearance is dangerous. It kills nobody directly. What it
does is invalidate every model in the world at once, which is a different kind of pressure from a
meteor: the organisms that come through it are the ones whose learning could keep up, not the ones
that were furthest from the impact.

### Communication

Two modalities, deliberately different in kind.

**Pheromone fields** diffuse and decay across the world. They persist after the organism leaves,
which is what makes trails and territory marks possible at all.

**Sound** is the second, and it is modelled as a physical phenomenon rather than as a set of
channels. The rule the whole subsystem is built around:

> The developer does not define what any sound means. If meaning appears, it has to come out of the
> environment, the ear, the brain, learning, social contact, reproduction and selection.

There is no `signal = FOOD` anywhere in this codebase, and no lookup table that could be one.

**The vocal apparatus** (`acoustics/sound.ts`) is an organ grown from the genome, with limits and no
intentions: a producible frequency band from two independently mutable edge genes, a power ceiling,
an agility that caps how fast pitch can move between ticks, and a tract character that biases how
tonal or how rough the voice is. Different lineages can physically reach different corners of
acoustic space, and mutation moves those corners around.

Seven brain outputs drive it — a gate plus pitch, loudness, noisiness, timbre, sweep and tremolo.
None of them means anything. How long the gate stays open *is* the duration of the call; opening and
closing it in a pattern *is* a sequence. No syntax is defined.

**Propagation** is real physics. Sound spreads geometrically, is absorbed exponentially with
distance, and — the consequential part — **is absorbed faster at high frequencies**. A low call
carries across the map and a high one stays local, so range and privacy are opposed and neither is
free. Undergrowth and water absorb more. Weather makes the world louder.

**The ear** is also an organ: a passband with its own two edge genes, a frequency resolution, and a
depth of echoic memory. Two populations whose bands stop overlapping cannot hear each other however
loud either one shouts. Masking is frequency-selective, as in a real ear, so a chorus sitting away
in pitch interferes far less than one sitting on top of you — which is the only reason it can ever
pay to call in a register nobody else uses.

Perception is degraded honestly. What arrives at the ear is jittered in proportion to how far the
signal sits above the racket and how good that particular ear is, so **two identical sounds are
never perceived identically**. An organism cannot hear well while it is shouting.

The brain receives pitch, loudness, direction, spread, noisiness, timbre, sweep, tremolo, onset,
duration, the ambient noise floor, how long it has been quiet, and the last few finished sounds with
the gaps between them. Not one of these is a symbol.

**Learned meaning, if any, is private.** Each organism carries a small vector-quantiser of the
sounds it keeps hearing, each with a value learned from its own reward stream via a decaying
eligibility trace — so "heard it, went over, found food" is learnable while most coincidences
average out. Two organisms that heard the same call after different outcomes disagree about it
permanently, and the brain is free to ignore the whole thing: the learned value arrives as one
ordinary input competing for the same synapses as pitch and loudness. Nothing here is inherited.

**Calling is expensive.** Energy cost scales with the square of loudness and rises with pitch, so
the call that carries furthest also costs the most and gives away the most about where its maker is.
Nothing rewards calling. Any benefit has to come from what other organisms do about it.

### Kin recognition

Six neutral **kin markers**, inherited Mendelian — each element comes from one parent, not blended.
Blending would drag every marker to the population mean within a few generations and destroy the
signal. Organisms sense the marker overlap of the neighbour they are attending to and the mean
overlap of their whole neighbourhood.

This is deliberately separate from genome-wide similarity, which the organism also senses. Genetic
distance conflates *being related* with *being adapted the same way*: two unrelated lineages
converging on the same body plan look identical to it. Kin markers track identity by descent, the
way real recognition cues do.

Combined with the **share** output — a plain energy transfer that loses 15% in transit — the
ingredients for kin selection exist. Sharing destroys energy at the population level, so it can only
be favoured when the receiver carries the giver's markers. Nothing implements parental care.

### Social learning and culture

The **imitate** output copies a fraction of a nearby organism's learned weights into your own. Only
the soma moves; inherited weights are untouched, so nothing acquired this way can reach the
germline. That makes a third inheritance channel alongside genes and individual learning.

Culture is not a flag anything sets — it is a claim that has to be demonstrated, and
`analysis/culture.ts` tries to demonstrate it two ways:

1. **Transmission index.** Compare how similar the learned weights of neighbours are against random
   pairs, and do the same for genetic distance as a control. Neighbours are usually relatives and
   relatives inherit similar brains, so the genetic excess is subtracted out. What remains is
   learned-behaviour clustering that shared ancestry does not explain.
2. **Meme persistence.** Each organism carries the id of whoever last shaped its soma — inherited at
   birth, overwritten by strong imitation, and replaced with its own id when individual learning
   reshapes its behaviour enough to count as working something out. A tag still carried by living
   organisms after that individual is dead is, by construction, behaviour that outlived its
   originator.

Both can report nothing, and often do.

### Reproduction and speciation

Sexual reproduction requires a compatible partner (genetic distance below a threshold) within range;
the cost is split between the parents. Asexual self-replication is always available at a 1.35×
penalty, so sexual reproduction is roughly 2.7× cheaper per offspring *when a partner exists*. The
two strategies compete on energy, not on preference.

Brain crossover swaps whole neurons rather than individual weights — swapping single weights between
two different brains destroys the function of a unit, the same reasoning behind NEAT's node
alignment, without the bookkeeping.

Mutation rate is itself a gene, so mutability evolves. Stable worlds favour low-mutation lineages;
after a mass extinction the high-mutation lineages tend to find the new optimum first.

A new species is recorded when an offspring drifts past the speciation threshold from its parent
species' reference genome, producing a real phylogenetic tree. Extinct species are kept permanently
in the Museum of Life.

### World events

Events perturb the **environment**, never the population. A heat wave raises temperature and lets
evolved tolerance decide who suffers. A blight cuts vegetation regrowth. A meteor scorches terrain
and throws up a cooling dust veil. Nothing here selects victims — the only direct physical damage in
the game is a meteor's blast radius, which is an actual impact.

---

## Derived observation

Three modules read telemetry and report on it. None of them can invent anything.

**Niche inference** (`analysis/niches.ts`) keeps a decaying running average per species of where its
members actually are and what they actually eat — temperature, elevation, biome histogram,
light-weighted activity, and the plant/carrion/prey split of intake. The labels ("forest",
"nocturnal", "scavenger") are thresholds over those measurements, and they are allowed to say
"generalist" or "unclear", which they often do. A species that changes habitat changes its
description.

**Call statistics** (`analysis/acoustics.ts`) is a field biologist, not part of the animal. It
clusters finished vocalisations into recurring acoustic shapes online, then reports, per shape: what
tended to be true of the world when it was used, what listeners tended to do in the seconds after
hearing it, how tightly it is reproduced, which species use it, how many generations it has spanned,
whether shapes follow each other in non-random order, whether calls answer calls above the rate at
which organisms have simply heard something, whether a reply resembles what it answered, and whether
different parts of the map have drifted into different repertoires. Anything that recurs but fits no
established shape is kept as an unknown pattern rather than forced into a category.

Associations are reported as standardised differences against the population, and the panel keeps
`OBSERVED`, `CORRELATED`, `INFERRED` and `UNKNOWN` visibly separate. The strongest claim the UI will
make is *"this shape is used disproportionately when the emitter is hungry, and listeners tend to
approach"* — never *"this means food"*.

**The analyser cannot reach the world.** There is no path from a call shape back into any organism's
senses, brain or fitness, and this is asserted rather than asserted-to-be-true: a test runs the same
seed twice while destroying the analyser's entire state every few ticks in one of them, and requires
the two worlds to unfold identically.

**Chronicle** (`analysis/chronicle.ts`) does two things. *Firsts* fire when a measurable threshold is
crossed and stays crossed for several samples — persistence is what separates "a channel twitched
once" from "this population communicates" — and each one records the numbers that triggered it.
*Anomalies* keep Welford running statistics per series and flag readings more than 3.2σ from that
series' own recent history, sustained. Each baseline is the series' own past, so an anomaly means
"unusual for this world", not "unusual in general".

Nine of the firsts are acoustic — sound produced at all, repeated shapes, an association, calls
following calls, replies resembling what they answer, non-random order, regional divergence, a shape
outliving its generation. If none of that happens, none of them is ever written, and a run that
stays silent, chaotic or completely alien is a valid result rather than a failure.

## Experiments on forks

The Lab panel forks the live world and runs controlled comparisons on it. Every arm starts from a
byte-exact copy of the current state — same organisms, same genomes, same RNG position — so the
control arm is a genuine control rather than a similar-looking separate run. Replicates differ only
in how the random stream continues from that shared instant.

Results are reported as mean ± spread across replicates, and any difference smaller than that spread
is reported as **inconclusive** rather than as a result. One run of an evolutionary simulation tells
you almost nothing; the founder bottleneck alone can swing the outcome by an order of magnitude.

Twelve preset hypotheses ship with it, each stating the claim and the reasoning behind it —
predation vs grouping, food patchiness vs memory, signal cost vs signal meaning, imitation cost vs
cultural transmission, transfer efficiency vs kin altruism.

Seven of them are the **ablation ladder**, and they are the only honest way to ask whether any of the
cognitive machinery is doing anything: run the same world twice with one faculty switched off.

| Hypothesis | Control arm vs |
| --- | --- |
| Does lifetime learning matter? | plasticity and auditory association off |
| Does the world model pay for its upkeep? | no world model at all |
| Does imagining before acting beat instinct? | no deliberation |
| Does taking value from learning help? | extrinsic reward only |
| Does volatility favour faster learning? | an almost unchanging world vs hard, fast seasons |
| Do delayed consequences select for memory? | nothing is poisonous vs strongly poisonous |
| Can hearing carry a belief? | sound informs nothing |

Every one of them can come back **inconclusive**, and several probably will. That is not a failed
experiment — it is the finding that the faculty did not pay for itself in that world, which is a
perfectly ordinary thing for a faculty to fail to do. The switches behind them live in `SimConfig`,
are never touched by the simulation itself, and exist purely so a control arm can be a real control.

### A worked result

From `npm run experiment` — fork at tick 8000, 3 replicates × 1500 ticks, treatment cuts vegetation
growth from 0.02 to 0.008:

```text
metric                control        treatment      delta%    d       verdict
population            865.33±20.21   261.67±0.58    -70%      -42.2   lower
avgGroupSize          4.19±0.07      0.93±0.11      -78%      -35.5   lower
sharesPerTick         33.78±4.34     5.77±4.64      -83%       -6.2   lower
imitationsPerTick     3.37±0.30      0.73±0.64      -78%       -5.3   lower
avgMemorySlots        0.53±0.03      0.64±0.03      +21%       +3.5   higher
```

The control arm's first replicate came out bit-identical to the parent world continued, and the
three replicates produced three distinct outcomes — so the spread column is measuring something
real.

Most of that table is one effect: starve the world and there are fewer organisms, so they meet each
other less, so they share and imitate less. Group size, sharing and imitation are all downstream of
population and should not be read as independent findings.

The interesting row is the last one. **Memory went up when food got scarce**, by 21% with an effect
size of 3.5 — while everything else about the population was collapsing. That is the
`scarcity-memory` hypothesis coming out positive, and it is a genuinely emergent result: memory
costs upkeep every tick, nothing rewards remembering, and the only reason a memory-heavy lineage
should win in a leaner world is that knowing where food was is worth more when food is harder to
find. It is one experiment on one seed and it should be repeated across seeds before anyone believes
it — but this is the machinery for doing that, and it produced a claim worth testing rather than a
number that was assumed.

## Determinism

Given the same seed, config and initial population, a run reproduces exactly, tick for tick — and a
fork continues its parent bit for bit.

- All randomness comes from one seeded `sfc32` stream, consumed in a fixed order.
- Nothing in `src/sim` reads the wall clock or calls `Math.random()`.
- Organisms are processed in ascending slot order; the free list is popped deterministically, and it
  is **serialised**, because slot reuse order feeds back into iteration order and therefore into the
  RNG stream.
- Even the diversity and culture samplers draw from the main stream, so they cannot perturb the run.
- `restore()` snapshots and reinstates the stream position around its own bookkeeping, so loading a
  world does not consume draws the parent never made.
- `Rng.normal()` deliberately does **not** cache the second Box-Muller value. That cached float is
  stream state the four saved words do not describe; with it, a restored world sat one draw away
  from where it was and a fork drifted from its parent within a few hundred ticks. This was a real
  bug, found by diffing a fork against its parent tick by tick, and it is now covered by a test.

Two tests cover this directly: two independently constructed simulations compared by fingerprint
after 400 ticks, and a fork compared against its still-running parent after 200 more.

Live parameter edits in the Lab panel deliberately break this for the current run — the panel says so.

---

## Reading the screen

Organism appearance is **generated from the genome**, not assigned:

| Visual | Gene |
| --- | --- |
| elongated body | muscle |
| thick shell rim | armor |
| warm red tint | meat-specialised gut |
| size | body-size |
| brightness | current energy |
| hue | a near-neutral marker, so lineages drift apart in colour |

Map overlays show the raw environment fields. Vegetation and Signal Field are the two worth watching
while it runs — they show what organisms are actually responding to.

Click any organism to open the inspector: genome, expressed body, life history, ancestry, kin
markers, its episodic memories with their valence, importance and whether each was lived or merely
heard, how well its model has been predicting and how surprised it currently is, whether it has been
getting better lately, how far ahead it deliberates and how much that deliberation changed its last
decision, what it is carrying that it cannot name, its vocal and auditory bands in hertz, the sounds
currently in its echoic buffer, what it has personally come to expect after each sound it keeps
hearing, which behaviour lineage it is running, and its **live brain** with activations and weights
— so "why did it do that" is answerable.

Panels, left to right: **World** (live stats), **Charts**, **Species** (with inferred niches),
**Voice** (the acoustic observatory and First Contact), **Culture** (imitation and meme lineages),
**History** (derived milestones and anomalies), **Minds** (the cognitive observatory), **Lab**
(forked experiments), **Museum**, **Inspect**, **Events**, **Setup**.

### The Minds panel

Three things, in descending order of how much they can be trusted.

**Trajectories** — what each species measured at, against generation. Brain width, memory slots,
prediction accuracy, learning rate, planning depth. These are measurements and they are presented as
measurements: nowhere does the panel say a lineage became smarter, because "smarter" is not a
quantity anything computed. `prediction accuracy 0.31 at generation 40, 0.62 at generation 900` is a
fact about the telemetry; what it means is the reader's problem, and deliberately so. Two lineages
with identical numbers can be doing completely different things — a deep planner running on a badly
fitted model and an accurate predictor that never plans both show up as "cognitive", and they are not
the same animal.

**Associations** — which environmental series moved together with which cognitive ones, over the
telemetry history. Food unpredictability against prediction accuracy, predation against planning
depth, and so on. Each is reported with its correlation coefficient and its sample count on the same
line, and nothing below `|r| = 0.35` or 24 samples is shown at all.

**A reading of it**, explicitly marked as a reading, followed by the experiment that would have to be
run to turn it into a result. Two quantities measured in the same world at the same time drift
together for all sorts of reasons that have nothing to do with either causing the other, and this
panel has no way to tell those cases apart. The Lab tab does. The panel says so rather than quietly
implying the work has already been done.

### Listening to it

The Voice panel has a **listen** button. Sound is off until you press it, because browsers require a
gesture to start audio and starting it unasked would be rude anyway.

The simulation never produces audio. It produces acoustic parameters, for thousands of organisms, as
six floats each — and only the dozen voices nearest the centre of the view are ever turned into real
sound, by a procedural synthesiser built from oscillators, a noise source and a filter. Every knob
on it comes from the organism's own vocal parameters, so what you hear is what its apparatus is
doing. That split is what keeps the audio affordable at any population.

### First contact

The same panel can open your **microphone**. Your voice is measured locally into the same six
numbers — a pitch by autocorrelation, a loudness, a noisiness from spectral flatness, a brightness
from the spectral centroid — and injected into the world at a point on the map, where it propagates
and is perceived by exactly the same code as any other sound. **The audio never leaves the page**,
there is no speech recognition, and nothing maps a human sound to an outcome.

The panel reports how hard listeners close on your sounds against how hard they close on sounds made
by organisms, and says plainly that a difference between the two is a difference in movement rather
than evidence that anything was understood — novelty alone would produce one.

If you want a noise of yours to come to mean something, you have to make it mean something the way
the world does: make the same noise, cause something the organisms care about, and do it often
enough that the ones who happen to react usefully outlive the ones who do not. It may never work.

---

## Measured behaviour

Numbers from `npm run bench` and `npm run sweep` on the default world (4096 units, 3000 founders,
`maxPopulation` 8000), not estimates:

| | |
| --- | --- |
| founder crash | 3000 → a few dozen by tick ~2000 |
| recovery | hundreds by ~6000, 1500–2300 by ~25000 |
| long-run population | oscillates, out of phase with total vegetation |
| carrying capacity | set by vegetation flux, comfortably below the array cap |
| generation depth | 95 by tick 30000 |
| living species | 44–83 in the long run |
| carnivory | 0.04–0.22 depending on seed — some worlds get meat-eaters, some don't |
| **memory** | 0.45–0.88 slots per organism — partly selected *away*, and that is a result |
| **group size** | 3.4–6.8 neighbours within perception |
| **broadcast** | 1.6–1.9 signal units per organism, sustained |
| **signal meaning** | strongest channel correlation **r = 0.23–0.43** |
| **imitation** | 7–29 events per tick |
| **behaviour lineages** | 1100–1500 distinct, of which **109–300 outlive their originator** |
| **energy transfers** | 4–22 per tick |
| transmission index | oscillates around zero, −0.05 to +0.19 |
| tick cost | ~9–10 ms at ~1800 organisms, single worker thread |
| founder survival | 7/8 seeds survive 8000 ticks |

Two of those deserve comment, because the honest reading is not the flattering one.

**Memory is being selected against.** Mean capacity sits below one slot. Memory costs upkeep every
tick and the default world's food is patchy but regrows locally, so remembering where food *was* is
often worth less than the upkeep. That is a real result about this world's economy, and the
`scarcity-memory` hypothesis in the Lab panel exists to test it properly rather than assert it.

**Culture is present but not established.** Hundreds of behaviour lineages genuinely outlive the
organisms that originated them, so behaviour does persist beyond the individual. But the
transmission index — neighbour soma similarity after subtracting the genetic excess — hovers around
zero rather than staying positive. Learned behaviour is spreading; it is not yet clustering more
than shared ancestry already explains. The `first-culture` milestone requires *both* signals to hold
for five consecutive samples, and in most runs it does not fire. It should not.

The early crash is the point, not a bug: generation 0 has random brains and most of it starves. What
matters is that enough survive for selection to have material, and that the recovery is driven by
descendants rather than by the founders.

Two things worth knowing about how those numbers were reached. Reproduction originally let a parent
pay for a clutch it could not afford, go negative, and get clamped back to zero — minting energy
into every offspring. The population then pinned against `maxPopulation` no matter how little food
the world produced, and there were no cycles at all. Separately, with every cost scaling by body
size, the cheapest organism was an arbitrarily tiny one, so the population miniaturised until upkeep
was nearly free; a fixed basal maintenance term fixes that. Both have regression tests, because both
looked like plausible ecosystems from the outside while being driven by arithmetic errors.

## Emergent behaviour to watch for

The project succeeds when you catch yourself saying *"I didn't program that."* Candidates:

- foraging appearing at all — the first few thousand ticks are mostly starvation
- populations that stop crashing and start oscillating
- a lineage crossing into carnivory, and prey answering with speed, armor or camouflage
- predator–prey cycles as out-of-phase oscillations of population and predation rate
- organisms clustering, following each other, or forming trails in the signal field
- geographic splits producing genuinely different species on either side of water
- brains growing only where the environment is hard enough to justify their upkeep

If the world is boring, the fix belongs in the environment, the energy economy, the sensory model or
the mutation operators — never in an `if` statement that produces the behaviour directly.

---

## Current state and what is next

Implemented: procedural world with climate and seasons, full genome/phenotype system, recurrent
brains with lifetime plasticity, emergent diet and predation, carrion, pheromone fields, sexual and
asexual reproduction, speciation with a phylogenetic tree, permanent extinction records, world
events, thirteen experiment presets, WebGPU rendering with a Canvas2D fallback, deterministic core,
IndexedDB persistence with file export/import, live charts and a full organism inspector.

Added in the world-model upgrade: a private linear predictive model per organism over its own hidden
layer, running at a quarter of the brain rate; prediction error split into latent and reward
components; learning progress with a noise-floor correction; intrinsic value from
`curiosity x progress x novelty`; a diagonal epistemic-uncertainty estimate; internal simulation and
shallow planning with evolvable depth and breadth and a per-step energy charge; a meta-rate that lets
recent surprise change the learning rate itself; eight loci for how an organism learns, all costed;
memory context fingerprints, importance and rest-time consolidation with offline replay; acuity-scaled
sensory noise; toxic vegetation as a delayed consequence with a shiftable cue; place-memories formed
from heard sounds; a cognitive observatory; and seven ablation hypotheses so every one of those
claims can be tested against a real control.

Added in the acoustic-communication upgrade: a genetically determined vocal tract and ear, sound
that propagates with frequency-dependent absorption, terrain absorption and frequency-selective
masking, perceptual jitter, echoic memory, a private reward-modulated associative memory for sounds,
a call-clustering observer that measures repertoire, sequence, turn-taking, imitation, dialects and
cross-generational persistence without ever defining a meaning, procedural Web Audio output and
local microphone input for first-contact experiments.

Added in the deep-ecosystem upgrade before it: episodic place memory with evolvable capacity and
real upkeep, evolved hearing range, Mendelian kin markers,
energy transfer between organisms, social learning that copies soma but never germline, meme lineage
tracking, telemetry-derived niche inference, a chronicle of derived milestones and statistical
anomalies, mutation categorisation, and byte-exact world forking with controlled multi-arm
experiments and replicate spread.

Deliberately not built yet, in rough priority order:

- **Morphological evolution.** The biggest remaining gap and the one most likely to produce
  genuinely strange creatures. Bodies are still one ellipse whose proportions come from the genome;
  segments, limbs and eye placement as developmental parameters would let mutation change body
  plans. This needs both a genome section and real renderer work, so it is its own project.
- **Objects and environment modification.** The action space is the right place for this — a grab
  output, carryable objects with physical properties, and terrain an organism can actually change.
  The feedback loop it creates (organisms reshape the world, the world reshapes selection) is the
  single most interesting unbuilt mechanic here.
- **Deeper representation learning.** The world model is linear over the brain's hidden layer, which
  means an organism can only predict what its evolved representation happens to make linearly
  predictable. That is a real constraint and arguably the right one at this population scale, but a
  small non-linearity — or a learned encoder separate from the policy — would widen what is
  discoverable. It should be driven by evidence that the linear model is the binding constraint, not
  by the assumption that bigger is better.
- **Pathogens.** Host-parasite coevolution needs a second evolving population with its own genome
  and transmission model. Straightforward in principle, but it changes the energy economy enough to
  need its own round of balancing.
- **An LLM observer.** The analysis layer already produces exactly the structured telemetry such a
  thing would consume, and deliberately separates measurement from interpretation. Wiring a model in
  is small; the reason it is not done is that everything currently reported can be checked against
  the numbers that produced it, and that property should not be given up casually.
- **Multiple worlds and migration**, then distributed regions. Nothing in the architecture prevents
  either — the simulation is already a self-contained object that serialises completely and runs in
  a worker — but neither is wired up.

- **Compute-shader offload.** Movement, sensing and environment sampling are the obvious candidates.
  The branchy parts (reproduction, speciation) should stay on the CPU. This is the change that takes
  the population ceiling from ~12k to 100k, and it should be driven by profiling, not assumption.
- **Population sharding across several workers**, spatially partitioned. The architecture allows it —
  nothing in the simulation assumes a single thread — but it is not wired up.
- **Deterministic replay from an event log.** The core is already deterministic and events are
  already logged; what is missing is the scrubber UI and periodic keyframes.
- **Morphological evolution** — segments, limbs and eye placement encoded as developmental
  parameters, so mutation can produce genuinely strange body plans rather than variations on an
  ellipse.

A note on the population ceiling: the CPU tick is dominated by the neighbourhood scan first and the
brain forward pass second. Two changes already took it from ~200 ms to ~35 ms per tick at 8000
organisms — precomputing heading vectors once per tick instead of calling `Math.cos`/`Math.sin`
inside the neighbour loop, and capping how many neighbours one organism considers. That cap is also
why `SpatialHash.queryInto` walks cells in expanding rings rather than raster order: when the buffer
fills in a dense herd, ring order drops the *far* candidates instead of silently discarding
everything to the south-east.

`maxPopulation` is a hard array cap, not a target. The world should reach its equilibrium well below
it — if the population sits exactly at the cap, something is wrong with the energy economy, and that
is worth investigating rather than raising the cap.

## Development tools

```bash
npm run bench -- 25000 2024      # headless run: population, species, generation, ms/tick
npm run sweep -- 6000 8          # survival across N seeds — catches fragile founder economies
npm run voice -- 12000           # what the acoustic layer is doing: calls, shapes, sequence, dialects
```

Both print incrementally, which the test runner does not, and both bypass the browser entirely.
Almost every tuning decision recorded above came from these two scripts rather than from watching
the simulation run.

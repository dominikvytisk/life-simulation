# Graph Report - life  (2026-08-11)

## Corpus Check
- 81 files · ~166,784 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 771 nodes · 1686 edges · 41 communities (31 shown, 10 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 40 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d3b53d52`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Brain and Spatial Core|Brain and Spatial Core]]
- [[_COMMUNITY_React UI Panels|React UI Panels]]
- [[_COMMUNITY_World Events and Experiments|World Events and Experiments]]
- [[_COMMUNITY_Telemetry Types and History|Telemetry Types and History]]
- [[_COMMUNITY_Signal Analysis and Brain View|Signal Analysis and Brain View]]
- [[_COMMUNITY_Niche Inference and RNG|Niche Inference and RNG]]
- [[_COMMUNITY_Simulation Core Loop|Simulation Core Loop]]
- [[_COMMUNITY_Rendering Pipeline|Rendering Pipeline]]
- [[_COMMUNITY_Culture and Population Store|Culture and Population Store]]
- [[_COMMUNITY_NPM Dependency Manifest|NPM Dependency Manifest]]
- [[_COMMUNITY_Sim Client Bridge|Sim Client Bridge]]
- [[_COMMUNITY_App TypeScript Config|App TypeScript Config]]
- [[_COMMUNITY_Speciation and Phylogeny|Speciation and Phylogeny]]
- [[_COMMUNITY_Chronicle and Event Log|Chronicle and Event Log]]
- [[_COMMUNITY_Node TypeScript Config|Node TypeScript Config]]
- [[_COMMUNITY_Build and Subpath Serving|Build and Subpath Serving]]
- [[_COMMUNITY_Neighbour Query Scaling|Neighbour Query Scaling]]
- [[_COMMUNITY_Claude Local Settings|Claude Local Settings]]
- [[_COMMUNITY_TypeScript Project References|TypeScript Project References]]
- [[_COMMUNITY_Brain Output Width|Brain Output Width]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 40|Community 40]]

## God Nodes (most connected - your core abstractions)
1. `Simulation` - 59 edges
2. `useStore` - 34 edges
3. `SimConfig` - 33 edges
4. `SimClient` - 30 edges
5. `Rng` - 28 edges
6. `Population` - 25 edges
7. `AcousticAnalyzer` - 21 edges
8. `World` - 21 edges
9. `compilerOptions` - 18 edges
10. `pitchToHz()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Transmission Index and Meme Persistence` --references--> `MemeRecord`  [INFERRED]
  README.md → src/sim/analysis/culture.ts
- `maxPopulation Is a Cap, Not a Target` --rationale_for--> `SimConfig`  [INFERRED]
  README.md → src/sim/core/config.ts
- `Speciation and Phylogenetic Tree` --references--> `SpeciesRegistry`  [INFERRED]
  README.md → src/sim/species/speciation.ts
- `Learning and Culture Readout` --references--> `Transmission Index and Meme Persistence`  [EXTRACTED]
  preview.png → README.md
- `Top Bar Readout (tick, year, pop, species, gen, ticks/s)` --conceptually_related_to--> `Founder Crash Is the Point`  [AMBIGUOUS]
  preview.png → README.md

## Import Cycles
- 2-file cycle: `src/gpu/canvasRenderer.ts -> src/gpu/renderer.ts -> src/gpu/canvasRenderer.ts`
- 2-file cycle: `src/gpu/renderer.ts -> src/gpu/webgpuRenderer.ts -> src/gpu/renderer.ts`

## Hyperedges (group relationships)
- **Behaviour Emerges From Costs, Not Rules** — readme_no_scripted_behaviour, readme_trait_costs, readme_energy_economy, readme_emergent_predation, readme_carrion_scavenging [EXTRACTED 1.00]
- **Three Inheritance Channels** — readme_germline_soma_split, readme_lifetime_learning, readme_social_learning, readme_culture_measurement, evolution_reproduction [EXTRACTED 1.00]
- **Determinism and Forkability Stack** — readme_determinism, readme_boxmuller_bug, readme_freelist_serialised, readme_forkable_experiments, core_rng [EXTRACTED 1.00]
- **Inspector Sections That Answer "Why Did It Do That"** — preview_vitals_section, preview_learning_culture_section, preview_memory_section, preview_broadcast_section, preview_live_brain [EXTRACTED 1.00]

## Communities (41 total, 10 thin omitted)

### Community 0 - "Brain and Spatial Core"
Cohesion: 0.15
Nodes (17): B1_SIZE, B2_SIZE, BRAIN_INPUT_WIDTH, clampRange(), copyBrain(), copyGenome(), crossoverBrain(), crossoverGenome() (+9 more)

### Community 1 - "React UI Panels"
Cohesion: 0.05
Nodes (62): pitchToHz(), getClient(), PanelTab, useStore, Chart(), Series, ChartsPanel(), ChroniclePanel() (+54 more)

### Community 2 - "World Events and Experiments"
Cohesion: 0.08
Nodes (34): ExperimentProgress, runExperiment(), Results(), ArmResult, compare(), COMPARED_METRICS, ComparedMetric, Comparison (+26 more)

### Community 3 - "Telemetry Types and History"
Cohesion: 0.11
Nodes (41): AcousticReport, AnomalyReport, Milestone, SeriesState, CultureReport, NicheProfile, SERIES_KEYS, SeriesKey (+33 more)

### Community 4 - "Signal Analysis and Brain View"
Cohesion: 0.18
Nodes (11): Top Bar Readout (tick, year, pop, species, gen, ticks/s), Vitals and Life History Readout, carrionEnergyDensity Cancelled Out of the Model, Carrion and the Scavenging Niche, Emergent Predation, Energy economy, Founder Crash Is the Point, Mendelian Kin Markers (+3 more)

### Community 5 - "Niche Inference and RNG"
Cohesion: 0.14
Nodes (7): hashString(), Rng, Box-Muller Cache Breaks Fork Determinism, Determinism, fingerprint(), Tests Gate the Deploy, GRAD2

### Community 7 - "Rendering Pipeline"
Cohesion: 0.11
Nodes (12): SnapshotField, SnapshotFlag, Canvas2DRenderer, Camera, createRenderer(), LifeRenderer, WebGPURenderer, "Morphology Is Generated" Legend (+4 more)

### Community 8 - "Culture and Population Store"
Cohesion: 0.05
Nodes (12): CultureAnalyzer, emptyReport(), MemeRecord, somaSimilarity(), SpatialHash, Population, Compute-Shader Offload (Unbuilt), Transmission Index and Meme Persistence (+4 more)

### Community 9 - "NPM Dependency Manifest"
Cohesion: 0.06
Nodes (30): dependencies, react, react-dom, zustand, devDependencies, tailwindcss, @tailwindcss/vite, @types/node (+22 more)

### Community 11 - "App TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, jsx, lib, module, moduleDetection, moduleResolution, noEmit (+11 more)

### Community 12 - "Speciation and Phylogeny"
Cohesion: 0.15
Nodes (7): Speciation and Phylogenetic Tree, romanish(), speciesName(), SpeciesRecord, SpeciesRegistry, SYLLABLES_A, SYLLABLES_B

### Community 13 - "Chronicle and Event Log"
Cohesion: 0.14
Nodes (6): Chronicle, fmt(), EventKind, EventKindId, EventLog, SimEvent

### Community 14 - "Node TypeScript Config"
Cohesion: 0.14
Nodes (13): compilerOptions, allowImportingTsExtensions, lib, module, moduleDetection, moduleResolution, noEmit, skipLibCheck (+5 more)

### Community 15 - "Build and Subpath Serving"
Cohesion: 0.29
Nodes (5): port, root, server, TYPES, Repository-Name Base Path

### Community 16 - "Neighbour Query Scaling"
Cohesion: 0.07
Nodes (23): accumulate(), describe(), NicheAccumulator, SimConfig, ActiveForcing, EVENT_NOISE, WorldEventSpec, WorldEventSystem (+15 more)

### Community 20 - "Community 20"
Cohesion: 0.09
Nodes (15): CONTEXT_FEATURES, RESPONSE_FEATURES, CALL_NAMES, normToDuration(), AcousticAnalyzer, Association, CallCluster, clampEffect() (+7 more)

### Community 21 - "Community 21"
Cohesion: 0.15
Nodes (19): Response, ECHO_GAP, echoOffset(), gapToNorm(), makePercept(), Percept, pushEcho(), resetPercept() (+11 more)

### Community 22 - "Community 22"
Cohesion: 0.14
Nodes (16): creditTrace(), Match, matchRadius(), recognise(), result, attenuation(), AuditoryApparatus, bandResponse() (+8 more)

### Community 23 - "Community 23"
Cohesion: 0.15
Nodes (14): Voice, MemeState, fastTanh(), forward(), hebbianUpdate(), imitate(), Input, Output (+6 more)

### Community 24 - "Community 24"
Cohesion: 0.20
Nodes (12): bandFromGenes(), randomizeBrain(), DEFAULT_CONFIG, randomGenome(), randomKinTags(), makeGenome(), Locus, expressInto() (+4 more)

### Community 25 - "Community 25"
Cohesion: 0.13
Nodes (15): A worked result, Architecture, Current state and what is next, Derived observation, Development tools, Directory map, Emergent behaviour to watch for, Experiments on forks (+7 more)

### Community 26 - "Community 26"
Cohesion: 0.22
Nodes (6): clamp01(), hzToPitch(), clamp(), clamp01(), MicCapture, MicFrame

### Community 27 - "Community 27"
Cohesion: 0.21
Nodes (4): LiveVoice, makeNoiseBuffer(), VoiceFrame, VoiceSynth

### Community 28 - "Community 28"
Cohesion: 0.18
Nodes (10): DISTANCE_WEIGHTS, LOCUS_CATEGORY, LocusName, makeMutationTally(), MutationCategory, MutationCategoryId, MutationTally, WEIGHT_SUM (+2 more)

### Community 29 - "Community 29"
Cohesion: 0.22
Nodes (9): LIFE Observatory Screenshot, Eight-Channel Broadcast Bars, Organism Inspector, Learning and Culture Readout, Project Pitch Panel (Left Rail), Procedural Island World View, Eight Meaning-Free Broadcast Channels, Persistent Pheromone Fields (+1 more)

### Community 30 - "Community 30"
Cohesion: 0.22
Nodes (9): Communication, Genome, How it works, Kin recognition, Memory, Neural network, Reproduction and speciation, Senses (+1 more)

### Community 31 - "Community 31"
Cohesion: 0.22
Nodes (7): Headless Bench and Seed Sweep, seed, sim, totalTicks, windowStart, seedCount, ticks

### Community 32 - "Community 32"
Cohesion: 0.33
Nodes (6): App HTML Entry Point, No Scripted Behaviour Rule, Deliberately Raw Egocentric Senses, World events, GitHub Pages Deploy Workflow, 404.html Deep-Link Fallback

### Community 34 - "Community 34"
Cohesion: 0.47
Nodes (4): INPUT_NAMES, OUTPUT_NAMES, BrainView(), Live Brain View With Activations

### Community 35 - "Community 35"
Cohesion: 0.33
Nodes (5): report, seed, sim, t0, TICKS

## Ambiguous Edges - Review These
- `Inert Hidden Units as Junk DNA` → `Whole-Neuron Brain Crossover`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to
- `Founder Crash Is the Point` → `Top Bar Readout (tick, year, pop, species, gen, ticks/s)`  [AMBIGUOUS]
  preview.png · relation: conceptually_related_to

## Knowledge Gaps
- **173 isolated node(s):** `PreToolUse`, `allow`, `name`, `private`, `version` (+168 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Inert Hidden Units as Junk DNA` and `Whole-Neuron Brain Crossover`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Founder Crash Is the Point` and `Top Bar Readout (tick, year, pop, species, gen, ticks/s)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Simulation` connect `Simulation Core Loop` to `Brain and Spatial Core`, `World Events and Experiments`, `Telemetry Types and History`, `Niche Inference and RNG`, `Culture and Population Store`, `Speciation and Phylogeny`, `Chronicle and Event Log`, `Neighbour Query Scaling`, `Community 21`, `Community 22`, `Community 23`, `Community 24`, `Community 28`, `Community 31`, `Community 33`, `Community 35`, `Community 36`, `Community 38`, `Community 39`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Why does `GitHub Pages Deploy Workflow` connect `Community 32` to `NPM Dependency Manifest`, `Niche Inference and RNG`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **Why does `SimConfig` connect `Neighbour Query Scaling` to `Brain and Spatial Core`, `React UI Panels`, `World Events and Experiments`, `Telemetry Types and History`, `Simulation Core Loop`, `Sim Client Bridge`, `Community 21`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **What connects `PreToolUse`, `allow`, `name` to the rest of the system?**
  _178 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `React UI Panels` be split into smaller, more focused modules?**
  _Cohesion score 0.051515151515151514 - nodes in this community are weakly interconnected._
# Graph Report - life  (2026-08-11)

## Corpus Check
- 81 files · ~166,784 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 718 nodes · 1592 edges · 26 communities (18 shown, 8 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9b537760`
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
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 40|Community 40]]

## God Nodes (most connected - your core abstractions)
1. `Simulation` - 59 edges
2. `useStore` - 34 edges
3. `SimConfig` - 32 edges
4. `SimClient` - 30 edges
5. `Rng` - 28 edges
6. `Population` - 24 edges
7. `AcousticAnalyzer` - 21 edges
8. `World` - 21 edges
9. `compilerOptions` - 18 edges
10. `pitchToHz()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Determinism` --references--> `fingerprint()`  [EXTRACTED]
  README.md → src/sim/simulation.test.ts
- `Ten-Panel Tab Navigation` --references--> `App()`  [INFERRED]
  preview.png → src/App.tsx
- `Live Brain View With Activations` --references--> `INPUT_NAMES`  [INFERRED]
  preview.png → src/sim/brain/brain.ts
- `Live Brain View With Activations` --references--> `OUTPUT_NAMES`  [INFERRED]
  preview.png → src/sim/brain/brain.ts
- `Tests Gate the Deploy` --rationale_for--> `Determinism`  [EXTRACTED]
  .github/workflows/deploy.yml → README.md

## Import Cycles
- 2-file cycle: `src/gpu/renderer.ts -> src/gpu/webgpuRenderer.ts -> src/gpu/renderer.ts`
- 2-file cycle: `src/gpu/canvasRenderer.ts -> src/gpu/renderer.ts -> src/gpu/canvasRenderer.ts`

## Hyperedges (group relationships)
- **Behaviour Emerges From Costs, Not Rules** — readme_no_scripted_behaviour, readme_trait_costs, readme_energy_economy, readme_emergent_predation, readme_carrion_scavenging [EXTRACTED 1.00]
- **Three Inheritance Channels** — readme_germline_soma_split, readme_lifetime_learning, readme_social_learning, readme_culture_measurement, evolution_reproduction [EXTRACTED 1.00]
- **Determinism and Forkability Stack** — readme_determinism, readme_boxmuller_bug, readme_freelist_serialised, readme_forkable_experiments, core_rng [EXTRACTED 1.00]
- **Inspector Sections That Answer "Why Did It Do That"** — preview_vitals_section, preview_learning_culture_section, preview_memory_section, preview_broadcast_section, preview_live_brain [EXTRACTED 1.00]

## Communities (26 total, 8 thin omitted)

### Community 0 - "Brain and Spatial Core"
Cohesion: 0.19
Nodes (12): format(), Slider(), countAlive(), deleteWorld(), exportWorld(), importWorld(), listWorlds(), loadWorld() (+4 more)

### Community 1 - "React UI Panels"
Cohesion: 0.06
Nodes (57): CALL_NAMES, CallCluster, fmt(), getClient(), PanelTab, useStore, Chart(), Series (+49 more)

### Community 2 - "World Events and Experiments"
Cohesion: 0.09
Nodes (28): ExperimentProgress, runExperiment(), DEFAULT_CONFIG, ArmResult, compare(), COMPARED_METRICS, ComparedMetric, Comparison (+20 more)

### Community 3 - "Telemetry Types and History"
Cohesion: 0.12
Nodes (39): AcousticReport, AnomalyReport, Milestone, SeriesState, CultureReport, NicheProfile, SERIES_KEYS, SeriesKey (+31 more)

### Community 6 - "Simulation Core Loop"
Cohesion: 0.05
Nodes (15): makeNicheAccumulator(), History, report, seed, sim, t0, TICKS, seed (+7 more)

### Community 7 - "Rendering Pipeline"
Cohesion: 0.13
Nodes (7): SnapshotField, SnapshotFlag, Canvas2DRenderer, Camera, createRenderer(), LifeRenderer, WebGPURenderer

### Community 8 - "Culture and Population Store"
Cohesion: 0.06
Nodes (7): CultureAnalyzer, emptyReport(), MemeRecord, MemeState, somaSimilarity(), SpatialHash, Population

### Community 9 - "NPM Dependency Manifest"
Cohesion: 0.06
Nodes (30): dependencies, react, react-dom, zustand, devDependencies, tailwindcss, @tailwindcss/vite, @types/node (+22 more)

### Community 11 - "App TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, jsx, lib, module, moduleDetection, moduleResolution, noEmit (+11 more)

### Community 12 - "Speciation and Phylogeny"
Cohesion: 0.14
Nodes (7): geneticDistance(), romanish(), speciesName(), SpeciesRecord, SpeciesRegistry, SYLLABLES_A, SYLLABLES_B

### Community 13 - "Chronicle and Event Log"
Cohesion: 0.15
Nodes (5): Chronicle, EventKind, EventKindId, EventLog, SimEvent

### Community 14 - "Node TypeScript Config"
Cohesion: 0.14
Nodes (13): compilerOptions, allowImportingTsExtensions, lib, module, moduleDetection, moduleResolution, noEmit, skipLibCheck (+5 more)

### Community 15 - "Build and Subpath Serving"
Cohesion: 0.29
Nodes (5): port, root, server, TYPES, Repository-Name Base Path

### Community 16 - "Neighbour Query Scaling"
Cohesion: 0.06
Nodes (24): accumulate(), describe(), NicheAccumulator, SimConfig, hashString(), Rng, ActiveForcing, EVENT_NOISE (+16 more)

### Community 20 - "Community 20"
Cohesion: 0.07
Nodes (21): CONTEXT_FEATURES, Response, RESPONSE_FEATURES, callDistance(), normToDuration(), pitchToHz(), AcousticAnalyzer, Association (+13 more)

### Community 21 - "Community 21"
Cohesion: 0.06
Nodes (66): creditTrace(), Match, matchRadius(), recognise(), result, ECHO_GAP, echoOffset(), gapToNorm() (+58 more)

### Community 25 - "Community 25"
Cohesion: 0.05
Nodes (42): INPUT_NAMES, OUTPUT_NAMES, BrainView(), App HTML Entry Point, LIFE Observatory Screenshot, Eight-Channel Broadcast Bars, Organism Inspector, Learning and Culture Readout (+34 more)

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (4): clamp(), clamp01(), MicCapture, MicFrame

## Knowledge Gaps
- **171 isolated node(s):** `PreToolUse`, `graphify`, `What is in it`, `Running it`, `Directory map` (+166 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Simulation` connect `Simulation Core Loop` to `World Events and Experiments`, `Telemetry Types and History`, `Culture and Population Store`, `Speciation and Phylogeny`, `Chronicle and Event Log`, `Neighbour Query Scaling`, `Community 21`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `GitHub Pages Deploy Workflow` connect `Community 25` to `NPM Dependency Manifest`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `SimConfig` connect `Neighbour Query Scaling` to `Brain and Spatial Core`, `World Events and Experiments`, `Telemetry Types and History`, `Simulation Core Loop`, `Sim Client Bridge`, `Community 21`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **What connects `PreToolUse`, `graphify`, `What is in it` to the rest of the system?**
  _171 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `React UI Panels` be split into smaller, more focused modules?**
  _Cohesion score 0.05811965811965812 - nodes in this community are weakly interconnected._
- **Should `World Events and Experiments` be split into smaller, more focused modules?**
  _Cohesion score 0.08739495798319327 - nodes in this community are weakly interconnected._
- **Should `Telemetry Types and History` be split into smaller, more focused modules?**
  _Cohesion score 0.11613475177304965 - nodes in this community are weakly interconnected._
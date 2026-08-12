# Graph Report - life  (2026-08-12)

## Corpus Check
- 88 files · ~192,042 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 788 nodes · 1806 edges · 44 communities (32 shown, 12 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.86)
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
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]

## God Nodes (most connected - your core abstractions)
1. `Simulation` - 67 edges
2. `useStore` - 36 edges
3. `SimConfig` - 33 edges
4. `SimClient` - 30 edges
5. `Rng` - 30 edges
6. `Population` - 30 edges
7. `World` - 22 edges
8. `AcousticAnalyzer` - 21 edges
9. `compilerOptions` - 18 edges
10. `UIState` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Ten-Panel Tab Navigation` --references--> `App()`  [INFERRED]
  preview.png → src/App.tsx
- `Live Brain View With Activations` --references--> `INPUT_NAMES`  [INFERRED]
  preview.png → src/sim/brain/brain.ts
- `Live Brain View With Activations` --references--> `OUTPUT_NAMES`  [INFERRED]
  preview.png → src/sim/brain/brain.ts
- `Determinism` --references--> `fingerprint()`  [EXTRACTED]
  README.md → src/sim/simulation.test.ts
- `Tests Gate the Deploy` --rationale_for--> `Determinism`  [EXTRACTED]
  .github/workflows/deploy.yml → README.md

## Import Cycles
- 2-file cycle: `src/gpu/canvasRenderer.ts -> src/gpu/renderer.ts -> src/gpu/canvasRenderer.ts`
- 2-file cycle: `src/gpu/renderer.ts -> src/gpu/webgpuRenderer.ts -> src/gpu/renderer.ts`

## Hyperedges (group relationships)
- **Behaviour Emerges From Costs, Not Rules** — readme_no_scripted_behaviour, readme_trait_costs, readme_energy_economy, readme_emergent_predation, readme_carrion_scavenging [EXTRACTED 1.00]
- **Three Inheritance Channels** — readme_germline_soma_split, readme_lifetime_learning, readme_social_learning, readme_culture_measurement, evolution_reproduction [EXTRACTED 1.00]
- **Determinism and Forkability Stack** — readme_determinism, readme_boxmuller_bug, readme_freelist_serialised, readme_forkable_experiments, core_rng [EXTRACTED 1.00]
- **Inspector Sections That Answer "Why Did It Do That"** — preview_vitals_section, preview_learning_culture_section, preview_memory_section, preview_broadcast_section, preview_live_brain [EXTRACTED 1.00]

## Communities (44 total, 12 thin omitted)

### Community 0 - "Brain and Spatial Core"
Cohesion: 0.15
Nodes (17): bandFromGenes(), PLASTIC_STRIDE, MODEL_FEATURES, expressInto(), lerp(), makePhenotype(), Phenotype, consolidateMemory() (+9 more)

### Community 1 - "React UI Panels"
Cohesion: 0.05
Nodes (64): pitchToHz(), fmt(), getClient(), useStore, Chart(), Series, ChartsPanel(), ChroniclePanel() (+56 more)

### Community 2 - "World Events and Experiments"
Cohesion: 0.17
Nodes (14): ExperimentProgress, runExperiment(), ArmResult, compare(), COMPARED_METRICS, ComparedMetric, Comparison, ExperimentArm (+6 more)

### Community 3 - "Telemetry Types and History"
Cohesion: 0.08
Nodes (52): AcousticReport, AnomalyReport, Milestone, SeriesState, analyseCognition(), CognitionLedger, CognitionReport, CognitiveAssociation (+44 more)

### Community 6 - "Simulation Core Loop"
Cohesion: 0.05
Nodes (14): makeNicheAccumulator(), History, randomizeBrain(), randomKinTags(), geneticDistance(), Recall, report, seed (+6 more)

### Community 7 - "Rendering Pipeline"
Cohesion: 0.13
Nodes (7): SnapshotField, SnapshotFlag, Canvas2DRenderer, Camera, createRenderer(), LifeRenderer, WebGPURenderer

### Community 9 - "NPM Dependency Manifest"
Cohesion: 0.18
Nodes (11): devDependencies, tailwindcss, @tailwindcss/vite, @types/node, @types/react, @types/react-dom, typescript, vite (+3 more)

### Community 11 - "App TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, jsx, lib, module, moduleDetection, moduleResolution, noEmit (+11 more)

### Community 12 - "Speciation and Phylogeny"
Cohesion: 0.15
Nodes (6): romanish(), speciesName(), SpeciesRecord, SpeciesRegistry, SYLLABLES_A, SYLLABLES_B

### Community 13 - "Chronicle and Event Log"
Cohesion: 0.13
Nodes (6): Chronicle, KIND_STYLE, EventKind, EventKindId, EventLog, SimEvent

### Community 14 - "Node TypeScript Config"
Cohesion: 0.14
Nodes (13): compilerOptions, allowImportingTsExtensions, lib, module, moduleDetection, moduleResolution, noEmit, skipLibCheck (+5 more)

### Community 15 - "Build and Subpath Serving"
Cohesion: 0.29
Nodes (5): port, root, server, TYPES, Repository-Name Base Path

### Community 16 - "Neighbour Query Scaling"
Cohesion: 0.20
Nodes (3): SimConfig, WorldEventSystem, World

### Community 20 - "Community 20"
Cohesion: 0.09
Nodes (16): CONTEXT_FEATURES, Response, RESPONSE_FEATURES, CALL_NAMES, normToDuration(), AcousticAnalyzer, Association, CallCluster (+8 more)

### Community 21 - "Community 21"
Cohesion: 0.13
Nodes (20): creditTrace(), Match, matchRadius(), recognise(), result, echoOffset(), attenuation(), AuditoryApparatus (+12 more)

### Community 22 - "Community 22"
Cohesion: 0.19
Nodes (19): pushReplay(), replayOne(), deliberate(), makePlanResult(), PlanResult, buildFeatures(), learn(), makePredictionError() (+11 more)

### Community 23 - "Community 23"
Cohesion: 0.18
Nodes (14): ECHO_GAP, gapToNorm(), makePercept(), Percept, pushEcho(), resetPercept(), fastTanh(), forward() (+6 more)

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (16): B1_SIZE, B2_SIZE, BRAIN_INPUT_WIDTH, DEFAULT_CONFIG, clampRange(), copyBrain(), copyGenome(), crossoverBrain() (+8 more)

### Community 25 - "Community 25"
Cohesion: 0.07
Nodes (30): A worked result, Architecture, Communication, Current state and what is next, Delayed consequences, Derived observation, Development tools, Directory map (+22 more)

### Community 26 - "Community 26"
Cohesion: 0.23
Nodes (5): Voice, clamp(), clamp01(), MicCapture, MicFrame

### Community 27 - "Community 27"
Cohesion: 0.13
Nodes (14): DISTANCE_WEIGHTS, Locus, LocusName, makeMutationTally(), MUTATION_CATEGORY_NAMES, MutationCategoryId, MutationTally, WEIGHT_SUM (+6 more)

### Community 28 - "Community 28"
Cohesion: 0.14
Nodes (14): armResult, base, comparisons, control, controlResult, fingerprint(), parent, parentPrint (+6 more)

### Community 29 - "Community 29"
Cohesion: 0.19
Nodes (9): accumulate(), describe(), NicheAccumulator, Biome, BIOME_NAMES, BiomeId, clamp01(), classifyBiome() (+1 more)

### Community 30 - "Community 30"
Cohesion: 0.21
Nodes (4): LiveVoice, makeNoiseBuffer(), VoiceFrame, VoiceSynth

### Community 32 - "Community 32"
Cohesion: 0.21
Nodes (5): CultureAnalyzer, emptyReport(), MemeRecord, MemeState, somaSimilarity()

### Community 33 - "Community 33"
Cohesion: 0.18
Nodes (11): scripts, bench, build, dev, experiment, preview, serve:subpath, sweep (+3 more)

### Community 34 - "Community 34"
Cohesion: 0.22
Nodes (7): ActiveForcing, EVENT_NOISE, WORLD_EVENT_INFO, WorldEventSpec, WorldEventType, WorldEventTypeId, Experiment

### Community 35 - "Community 35"
Cohesion: 0.22
Nodes (8): dependencies, react, react-dom, zustand, name, private, type, version

### Community 36 - "Community 36"
Cohesion: 0.32
Nodes (3): Determinism, fingerprint(), small

### Community 38 - "Community 38"
Cohesion: 0.25
Nodes (8): LIFE Observatory Screenshot, Eight-Channel Broadcast Bars, Organism Inspector, Learning and Culture Readout, Project Pitch Panel (Left Rail), Episodic Memory Slots (0/8, empty), Vitals and Life History Readout, Procedural Island World View

### Community 42 - "Community 42"
Cohesion: 0.47
Nodes (4): INPUT_NAMES, OUTPUT_NAMES, BrainView(), Live Brain View With Activations

### Community 43 - "Community 43"
Cohesion: 0.50
Nodes (4): App HTML Entry Point, GitHub Pages Deploy Workflow, 404.html Deep-Link Fallback, Tests Gate the Deploy

## Knowledge Gaps
- **181 isolated node(s):** `PreToolUse`, `allow`, `name`, `private`, `version` (+176 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Simulation` connect `Simulation Core Loop` to `Brain and Spatial Core`, `Community 34`, `Telemetry Types and History`, `Community 36`, `World Events and Experiments`, `Community 39`, `Culture and Population Store`, `Speciation and Phylogeny`, `Chronicle and Event Log`, `Neighbour Query Scaling`, `Community 21`, `Community 22`, `Community 23`, `Community 24`, `Community 27`, `Community 28`, `Community 31`?**
  _High betweenness centrality (0.106) - this node is a cross-community bridge._
- **Why does `GitHub Pages Deploy Workflow` connect `Community 43` to `Community 35`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Why does `SimConfig` connect `Neighbour Query Scaling` to `React UI Panels`, `World Events and Experiments`, `Telemetry Types and History`, `Community 34`, `Simulation Core Loop`, `Sim Client Bridge`, `Community 23`, `Community 24`, `Community 28`, `Community 29`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **What connects `PreToolUse`, `allow`, `name` to the rest of the system?**
  _181 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `React UI Panels` be split into smaller, more focused modules?**
  _Cohesion score 0.054455445544554455 - nodes in this community are weakly interconnected._
- **Should `Telemetry Types and History` be split into smaller, more focused modules?**
  _Cohesion score 0.07643600180913614 - nodes in this community are weakly interconnected._
- **Should `Simulation Core Loop` be split into smaller, more focused modules?**
  _Cohesion score 0.05333333333333334 - nodes in this community are weakly interconnected._
# BlueLine current module map

## ACC/AEB handback and bidirectional shoulder ALC — 2026-10-29

See [the Vietnamese research and implementation report](ACC_AEB_PHOI_HOP_VA_LAN_KHAN_CAP_2026-10-29.md). Reviewed primary Kia, Volvo and NHTSA sources, retaining explicit differences between OEM examples and BlueLine. Pedal-to-ACC handback now starts from actual applied acceleration; AEB still bypasses comfort limiting and cancels cruise. A marked simulation option permits ALC into/out of the motorway shoulder, models its true centre as a separate lateral target and maintains lane support there. Rear-approach gap checks, manual braking and parking interlocks remain active.

## Repeated turn-signal commands during ALC — 2026-10-29

See [the current Vietnamese repeat-signal repair report](SUA_XI_NHAN_GIUA_LAN_2026-10-29.md). The simulation recognises an active lateral manoeuvre before toggling a signal: duplicate/opposite stalk taps leave that single manoeuvre unchanged, while ordinary pending/manual signals still toggle. Real cancellation adopts the occupied lane for remaining LFA support instead of the stale origin. Lateral grip saturation now has a distinct alert cause from excessive road-curve speed. The new regression compares 96 physical baseline/repeated-command pairs and verifies genuine takeovers, completion and warning causes; the UI was also exercised directly.

## All-speed ALC — 2026-10-29

See [the current Vietnamese all-speed ALC report](ALC_MOI_DAI_TOC_DO_2026-10-29.md). Removed the 80/15 km/h entry gates. The default supports marked adjacent same-direction lanes, with motorway-only operation an optional road-domain setting. Distance-aware quintic progress, tangent/curvature feedforward and progress-scaled timeout now handle crawling, stopping and resuming without a position jump. Completion owns the indicator until the car settles. Gap forecasts adapt to speed; faults, driver override, pedestrians/junctions and unsafe rear approaches still inhibit the manoeuvre. Ninety-two physical matrix runs, six complete ACC integrations, twenty regression suites and the final eight relevant suites passed, plus direct browser verification at low speed.

## ALC signal request recovery — 2026-10-29

See [the Vietnamese ALC repair report](SUA_ALC_XI_NHAN_2026-10-29.md). Initial eligibility rejections no longer consume the indicator request. A committed manoeuvre can continue through a speed drop below the entry threshold, while safety/driver aborts still require a fresh signal. The ADAS dock now displays the actual rejection reason without relying on a tooltip. Eight relevant suites and the build passed; clear-lane changes were exercised directly in the browser.

## Emergency shoulder and unresponsive-driver stop — 2026-10-29

See [the Vietnamese EDSS implementation and verification report](LAN_KHAN_CAP_EDSS_2026-10-29.md). `EmergencyPullOver` now coordinates physical speed reduction, gap checks, incremental right lane changes, shoulder entry, stopping and P/EPB/hazards. Motorway geometry uses right-hand traffic with 3.5 m paved outer shoulders and guardrails outside them; ambient vehicles use ordinary lanes. `Simulation`, `ExtendedAssistance`, ADAS settings, instruments and audio share the actual state. Replay stores the controller and converts legacy motorway lateral coordinates. Driver nonresponse and map localisation remain simulated inputs, not medical recognition or an OEM ECU.

## Browser-verified cabin correction — 2026-10-28

The local browser is now accessible. See [the direct cabin verification report](KIEM_TRA_CABIN_TRUC_TIEP_2026-10-28.md) for observed CSS bugs, corrected mirror views, docked surround camera, three viewport sizes, day/night checks and remaining art/performance limits. The build and eight relevant regression suites passed. Browser-blocked notes below are historical.

## Cabin correction — 2026-10-28

See [the cabin correction report](CABIN_2026-10-28.md). `CarInterior`, `CockpitRig` and `CockpitInstruments` now separate the complete interior, camera calibration and live displays. `CabinLookControls` adds held glances and right-drag recentering. The runner contains 23 suites; eight relevant suites and the build passed for this cabin change. Browser visual verification remains blocked by disabled local browser use.

## Update — 2026-10-27 / v0.6

See [the Vietnamese v0.6 upgrade and verification report](NANG_CAP_V06.md) for the current implementation and limits. The audit below is retained as historical context.

| Module | Current addition |
| --- | --- |
| `vehicle/Powertrain.ts`, `vehicle/Vehicle.ts` | Neutral coasting, approximate RPM, applied surface braking, manual friction-circle limits |
| `core/collision.ts`, `sim/Simulation.ts` | Rotated body contact, swept motion, contact response, safer lane-change gate and replay travel direction |
| `world/track.ts` | Three selectable circuits used by the world and simulation |
| `traffic/TrafficManager.ts`, `pedestrian/PedestrianManager.ts` | Occupied-lane footprints, cross-traffic yielding, connected signal-controlled actors, safe pedestrian gap checks |
| `ui/scenarios.ts` | Twenty named scenarios, including school, market, roadworks and reverse cross-traffic |
| `render/CockpitGeometry.ts`, `render/CarFleet.ts` | Continuous dashboard, common steering pivot, live instruments/navigation, exterior surround render and vehicle resource disposal |
| `render/RoadView.ts`, `render/PedestrianView.ts` | Lit PBR asphalt, pavement edges, weather surface appearance and articulated walking figures |
| `ui/CockpitLayout.ts` | Cockpit FOV/seat height, steering/deadzone, rendering quality and persisted preferences |

The v0.6 baseline below contained 21 suites. Browser visual and hardware verification remained unavailable while local browser use was disabled in Work settings.

Audit date: 2026-10-26

## Runtime shape

- Browser-only TypeScript app built with Vite and Three.js. There is no backend.
- `src/main.ts` wires the simulation core, Three.js scene, procedural views, HUD, panels, and a fixed-timestep animation loop.
- `src/sim/Simulation.ts` is the headless integration point. It owns the world state and connects sensing, behavior, planning, control, traffic, pedestrians, metrics, and the learned policies.
- `src/core/` contains dependency-free math, matrix, linear algebra, and polynomial helpers.

## Existing modules and observed status

| Area | Source | Current capability | Status / limit |
|---|---|---|---|
| Road model | `world/track.ts`, `world/ReferencePath.ts`, `world/Road.ts` | One closed, rounded city loop; Frenet projection, curvature, and three-lane road geometry | Functional; this is one fixed map, not a global or editable road network |
| Vehicle dynamics | `vehicle/Vehicle.ts` | Kinematic bicycle with steering, acceleration, speed, and deceleration limits | Functional educational model; not a validated vehicle dynamics model |
| Planning | `planner/FrenetPlanner.ts`, `planner/Trajectory.ts`, `core/poly.ts` | Candidate Frenet trajectories, costs, speed targets, and obstacle checks | Functional in the classical simulation path; does not use the occupancy grid as its planner input |
| Behavior | `behavior/BehaviorPlanner.ts` | Cruise, follow, overtake, yield, stop, and emergency decisions | Functional against the planner's obstacle list |
| Control | `control/Stanley.ts`, `control/PID.ts`, `control/PurePursuit.ts` | Stanley lateral control and PID speed control are wired into `Simulation`; Pure Pursuit exists as an unused alternative | Existing autonomous controller works in smoke runs |
| Traffic | `traffic/TrafficManager.ts`, `traffic/IDM.ts`, `traffic/MOBIL.ts` | IDM car following, MOBIL lane changes, International and Vietnam traffic mixes, car/truck/bus/motorcycle actors, cut-ins, stalled cars, blind-spot setup, and scripted perpendicular cross-traffic | Functional cases on the existing loop; no separate national road network, jurisdiction-specific driving rules, or intersection right-of-way model |
| Pedestrians | `pedestrian/PedestrianManager.ts`, `render/PedestrianView.ts` | Scripted crosswalk, occlusion, and jaywalking cases | Functional for the included scenarios; not a pedestrian route/crowd model |
| Perception | `perception/Sensor.ts`, `perception/Tracker.ts`, `perception/OccupancyGrid.ts` | Noisy range/line-of-sight detections, dropout, constant-velocity Kalman tracks, occupancy visualization | Functional approximation; no camera image, lidar point cloud, radar Doppler, or sensor fusion model. The grid is currently for visualization, not planning |
| Signals / signs | `world/TrafficLight.ts`, `render/TrafficLightView.ts`, `world/RoadSign.ts`, `render/RoadSignsView.ts` | Timed lights, stop-line speed constraint, procedural 50 km/h signs and speed cap in the classical planner | Functional on the fixed loop; signs are not jurisdiction data and signs do not yet govern Manual or ADAS modes; no intersection right-of-way model |
| AI drivers | `learn/NN.ts`, `learn/ImitationAgent.ts`, `learn/Trainer.ts`, `learn/Evolution.ts`, `learn/Benchmark.ts` | From-scratch MLP, imitation/DAgger training, evolutionary policy, benchmark | Headless learning and evolution scripts pass. Saved brains use localStorage |
| Safety / ADAS | `sim/ADAS.ts`, `sim/Simulation.ts`, `ui/ADASPanel.ts` | ACC with stop & go and five headway settings, lane centring, LDW, two-stage FCW, AEB (vehicles + pedestrians), BSM, turn-signal-driven assisted lane change, TSR + ISA, parking sensors, and a live surround-view panel with an intervention log | Headless checks pass; simulation-only models, not real-car ADAS or safety validation. The ADAS speed loop uses its own PID so it cannot collide with the planner's controller |
| Metrics / sessions | `sim/Metrics.ts`, `sim/SessionRecorder.ts`, `ui/Scorecard.ts` | Safety, comfort, efficiency, distance, collision, and gap metrics; capped 18,000-frame snapshots, replay, JSON export | Headless replay restores captured state; no import UI, and playback is snapshot replay rather than deterministic re-simulation |
| Rendering | `render/Scene.ts` and `render/*View.ts` | Procedural Three.js road, lit city façades, cars/SUVs/hatchbacks/trucks/buses/motorcycles with spinning and steered wheels, body roll/pitch, brake lights, turn signals, night headlamps, plates and contact shadows; IBL day/night, cross-streets, signals, signs, pedestrians, path, tracks, occupancy, weather, chase/top/cabin/orbit cameras and a dashboard | Visuals and cabin are procedural approximations; no imported vehicle/environment assets or camera sensor images |
| UI | `ui/ControlPanel.ts`, `ui/DriveControls.ts`, `ui/LearningPanel.ts`, `ui/HUD.ts`, `ui/ADASPanel.ts`, `ui/IntroOverlay.ts`, `ui/Minimap.ts`, `ui/Shortcuts.ts` | Launch menu (mode/scenario/weather), gear/speed-limit/turn-signal cluster, ADAS surround view, manual and ADAS keyboard driving with turn signals, AI driver and traffic-profile selection, scenarios and live event injection, speed/density, overlays, pause/reset, cameras, weather, day/night, AI training/selection, scorecard, minimap, session controls | Functional in browser; deep links accept `profile`, `scenario`, `mode=adas\|manual`, `cam`, `weather`, `tod=day`, `intro=0`; scenario tools inject a small fixed set of events rather than author arbitrary maps |
| Audio | `audio/SimulationAudio.ts` | User-enabled procedural engine tone, traffic ambience, tyre scrub, turn-signal ticks, repeated AEB chime, and impact thud | Browser Web Audio implementation; not based on recorded acoustic samples or a vehicle sound model |

## Baseline verification

The project initially had no installed local dependencies, so the first build could not find `tsc`. After `npm ci` from the checked-in lockfile:

- `npm run build`: passed; Vite emitted a 577.49 kB minified JS chunk warning.
- `npx --yes tsx scripts/smoke.ts`: passed, 9 scenarios, no reported vehicle or pedestrian collisions.
- `npx --yes tsx scripts/weather-test.ts`: passed for clear, rain, and fog.
- `npx --yes tsx scripts/learn-test.ts`: passed; learned policy had no reported collision in its two evaluation runs.
- `npx --yes tsx scripts/evo-test.ts`: passed; evolved policy had no reported collision in its evaluation run.
- `npx --yes tsx scripts/lights-test.ts`: the original assertion only watched the first signal, and later the added speed signs shifted incidental signal arrival phases. The final test observes every scenario light plus a deterministic red-to-green test phase; the ego stopped, progressed, and recorded zero red crossings.
- `npx --yes tsx scripts/adas-test.ts`: passed manual input, lane centering, ACC following, FCW/AEB triggering, blind-spot detection, and Simulation-level AEB integration.
- `npx --yes tsx scripts/traffic-profile-test.ts`: passed the profile mix and Vietnamese motorcycle blind-spot setup.
- `npx --yes tsx scripts/record-replay-test.ts`: passed 180-frame state snapshot replay and JSON export.
- `npx --yes tsx scripts/scenario-lab-test.ts`: passed live stopped-lead, cut-in, pedestrian, and perpendicular crossing event checks.
- `npx --yes tsx scripts/road-sign-test.ts`: passed the classical planner speed cap from a procedural sign.

The final full verification pass succeeded after traffic signs and scripted cross-traffic were integrated: build, smoke, lights, weather, learning, evolution, ADAS, profiles, scenario events, signs, and recording/replay. The International profile remains the default.

The final production build generated a 620.99 kB minified JavaScript chunk and still emits Vite's 500 kB chunk-size warning. Browser interaction was checked for Vietnam profile selection, cabin camera, sound enablement, recording, cross-traffic event insertion, and replay; the browser reported no console errors.

There is now a `test` script in `package.json`: `npm test` bundles every headless TypeScript check with esbuild and runs it with Node via `scripts/test.mjs` (15 suites, all passing at the time of writing). `npm ci` reported 6 dependency advisories (2 moderate, 4 high); this audit did not change dependency versions.

## v0.4 ADAS / vehicle pass

- ADAS was expanded from five toggles to a full suite: ACC stop & go with selectable headway, LDW, two-stage FCW, AEB with pedestrians, BSM, assisted lane change on the turn signal, TSR + ISA and parking sensors. A dedicated `ADASPanel` draws the perceived-surround view and an intervention log.
- The ADAS longitudinal loop now uses its own PID. Previously both the planner controller and the assistance layer updated one PID with unrelated errors inside the same timestep, producing a large derivative spike that pinned the car at full throttle.
- Vehicles gained animated wheels/steering, body attitude, brake lights, turn signals, night headlamps, plates, contact shadows, three body variants and a realistic paint palette. The scene uses day/night IBL, and buildings use additive lit windows.
- A launch menu, speed-limit/turn-signal cluster, collision flash and new audio cues were added; the debug perception overlays now default to off for a cleaner view.

## Recommended implementation phases

1. **Done:** preserve the baseline, document the module map, and check every signal in the light test.
2. **Done:** add Manual Drive and simulation-only ADAS Assisted Drive, with separately tested ACC, lane centering, FCW, AEB, and BSM. Learned AI and its shield remain available.
3. **Partial:** International and Vietnam actor mixes, motorcycles, buses, cut-ins, blind-spot cases, and scripted perpendicular cross-traffic are implemented on one generic loop. Separate national road networks and local driving rules remain.
4. **Implemented, procedural:** cabin camera/dashboard, speed signs, motorcycle/bus rendering, and intersection actors. Higher-fidelity authored assets, camera sensor models, turn movements, and right-of-way logic remain.
5. **Partial:** procedural event audio, a small fixed live-event toolbox, capped state recording/replay and JSON export are implemented. There is no arbitrary scenario editor, import flow, or deterministic re-simulation.
6. **Partial:** UI controls are exposed and browser-checked, but a complete premium visual redesign, responsive/mobile pass, and broader usability review remain.

## Repository limitations

- This checkout has no `.git` directory, so changes cannot be reviewed through a Git diff or committed here.
- `package.json` has no test runner or `test` script; checks are standalone TypeScript scripts.
- `npm ci` reported 6 dependency advisories (2 moderate, 4 high). Dependency upgrades were not attempted as part of this feature work.

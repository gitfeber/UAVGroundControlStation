# Handoff: Ground Target Estimation (DEM Raycast)

**Project:** `uav-ground-control-station`  
**Date:** 2026-06-08  
**Status:** Implemented on branch `feat/ground-target-estimation` (Steps A–H complete)  
**Handoff for:** Review, field testing, and PR merge

---

## Goal

Estimate WGS84 coordinates of ground target at **video image center** by:

1. Building camera optical-axis ray from UAV pose + gimbal + camera mount
2. Intersecting ray with local DEM
3. Returning lat/lon, terrain elevation, slant/ground range, quality

Target accuracy: few meters to ~10 m. No object detection, no photogrammetry v1.

Full spec: user message in session (15 sections, Steps A–H). Reference that message; do not duplicate here.

---

## Repo snapshot (implemented)

| Area | State |
|------|--------|
| `TelemetryState` | `packages/shared` — `sampledAtMs`, `gimbal`, target-estimation types |
| MAVLink desktop parser | `apps/desktop/src-tauri/src/lib.rs` + `gimbal.rs` — 285/265 decode, pose `sampledAtMs` |
| Geo math | `packages/target-estimation/src/geo.ts` — WGS84 ↔ ENU |
| DEM / raycast | `apps/desktop/src-tauri/src/dem.rs` + `packages/target-estimation` ray march |
| Video | `VideoPanel.tsx` — crosshair + compact target readout |
| Tests | `packages/target-estimation` unit tests + Rust parser/gimbal/DEM tests |
| ADR | `docs/adr/0005-target-estimation-ts-rust-split.md` — TS core, Rust DEM I/O |
| Glossary | `CONTEXT.md` — target estimation terms |

**Version:** `0.2.11` (bump on further functional change per project rules)

---

## Modules (built)

1. **Shared types** — `packages/shared/src/targetEstimation.ts`
2. **Telemetry ring buffer** — `packages/target-estimation/src/telemetryBuffer.ts`
3. **Target estimation core** — `packages/target-estimation` (`estimateTarget`, `rayIntersect`, `quality`)
4. **DEM** — Rust GeoTIFF window cache; TS `TauriDemTerrainProvider`
5. **Coordinates** — WGS84 ↔ ENU; altitude mode + offset in settings
6. **UI** — `GroundTargetPanel`, `VideoPanel` overlay, map marker/LOS in `MapPanel`
7. **Logging/export** — in-memory ring + JSON/CSV export + desktop save dialog
8. **Tests** — flat/sloped terrain, horizon reject, missing gimbal/DEM, latency buffer

**Implementation order:** A → H complete.

---

## Resolved decisions

- **Runtime split (ADR 0005):** Option C — `packages/target-estimation` (math, buffer, tests, synthetic terrain) + `apps/desktop/src-tauri` (GeoTIFF, cache, Tauri commands). Real DEM desktop-only v1; browser uses synthetic terrain.
- **Glossary:** Ground target, Target estimate, Terrain model, Gimbal attitude, Camera configuration in `CONTEXT.md`.
- **Gimbal telemetry (Q2):** Option D — unknown/mixed stack. Decode priority `285 → 265 → body-fixed ATTITUDE`. Runtime frame-stats show which IDs arrive. `CameraConfig` convention flags (frame, pitch sign, yaw ref, calibration offsets). No gimbal + body-fixed not enabled → `valid: false`, `quality: bad`, `reason: gimbal_unavailable`.
- **Video time base (Q3):** A + D-ready API. v1: 10 Hz tick, `atPcTimeMs = performance.now() - videoLatencyMs`, buffer lookup by `telemetry.sampledAtMs` (new field; not `lastPacketAt`). API accepts optional explicit `atPcTimeMs` later for frame metadata.
- **Vertical datum (Q4):** A + D-lite. Default `altitudeMode: "amsl"`, `altitudeOffsetM: 0`. Ray origin `altMsl + offset`. Fallback to relative + terrain at UAV → `quality: warn`. No ellipsoid/geoid v1. DEM metadata exposes `verticalDatum`, `horizontalCrs`, `resolutionM`. UI calibration note required.
- **ENU anchor (Q5):** A — per-estimate UAV position at latency-corrected time. `cameraOriginEnu = [0,0,rayOriginZ]`. DEM queries reproject via same anchor. Map LOS uses same estimate's UAV + hit. Tick jitter OK.
- **DEM loading (Q6):** B + batched IPC. Rust sliding window cache (default 4 km × 4 km, recenter at 50% margin). `getElevationsAlongRay(...)` for batched elevation. TS `TauriDemTerrainProvider`. Out of bounds → `dem_out_of_coverage`; nodata → `dem_nodata`. Desktop **Browse…** uses native file picker; manual path still supported.
- **Quality gates (Q7):** Adopt proposed table. Worst-wins aggregation. 3D GPS required for `valid: true`. Body-fixed gimbal when enabled → `warn`. Stale telemetry warn at 500 ms. Horizon min 5° below horizontal. Warn gates still compute/show coords when math allows.
- **UI (Q8):** D — hybrid. VideoPanel: crosshair + compact strip (lat/lon, slant, quality pill). Sidebar sortable "Ground Target" panel: full readout + all config. Map: marker + LOS for valid/warn; hide on bad. Settings `localStorage` `uav-gcs.target.*`. Tauri file picker for DEM and sample-log save.
- **Orchestration (Q9):** B — `TargetEstimationSession` in `packages/target-estimation` owns buffer + estimation. Thin `useTargetEstimation` hook in web. Replay/sim → `target_estimation_live_only`.
- **Logging/export (Q10):** A — in-memory ring 600 samples (~60 s). Slim telemetry slice per sample. Manual JSON/CSV export + clear. Optional Tauri `save_target_log` via save dialog. No replay pollution; no continuous disk write.

## Resolved decisions summary (10/10)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Runtime split | C — TS core + Rust DEM (ADR 0005) |
| 2 | Gimbal | D — 285→265→body-fixed; runtime discovery |
| 3 | Video time | A + D-ready API; 10 Hz; `sampledAtMs` |
| 4 | Altitude | A + D-lite; amsl default + offset |
| 5 | ENU anchor | Per-estimate UAV position |
| 6 | DEM load | B + `getElevationsAlongRay` IPC; 4 km window |
| 7 | Quality gates | Full table; 3D GPS required; 500 ms stale |
| 8 | UI | D — hybrid video + sidebar + map |
| 9 | Orchestration | `TargetEstimationSession` + thin hook |
| 10 | Logging/export | In-memory ring + manual JSON/CSV export |

**Grill complete. Implementation complete.**

## Implementation checklist (Steps A–H)

- [x] **A** — Shared types: `GimbalState`, `CameraConfig`, `TerrainProvider`, `TargetEstimate`, extend `TelemetryState` with `sampledAtMs` + gimbal
- [x] **B** — Telemetry ring buffer + timestamp lookup/interpolation in `packages/target-estimation`
- [x] **C** — `TargetEstimationSession` + synthetic flat terrain
- [x] **D** — Raycasting + unit tests
- [x] **E** — Rust GeoTIFF window cache + `get_elevations_along_ray` + `TauriDemTerrainProvider`
- [x] **F** — UI: VideoPanel overlay, Ground Target sidebar, map marker/LOS, Tauri file pickers
- [x] **G** — Sample log ring + JSON/CSV export (+ `save_target_log` via dialog)
- [x] **H** — MAVLink 285/265 decode + frame stats in Rust

## Artifacts updated

- `docs/adr/0005-target-estimation-ts-rust-split.md`
- `CONTEXT.md` — target estimation glossary terms
- `README.md` — operator workflow, DEM smoke test, Tauri commands
- `docs/fixtures/gimbal-device-attitude-status-285.md`

---

## Key files

```
packages/shared/src/targetEstimation.ts
packages/target-estimation/
apps/desktop/src-tauri/src/dem.rs
apps/desktop/src-tauri/src/gimbal.rs
apps/web/src/hooks/useTargetEstimation.ts
apps/web/src/components/GroundTargetPanel.tsx
apps/web/src/lib/tauriDemTerrain.ts
apps/web/src/lib/tauriDialogs.ts
```

---

## Constraints (from project rules)

- Desktop canonical for production TX16S/CRSF/COM
- TypeScript in monorepo; shared contracts in `packages/shared`
- Bump version in `package.json`, `apps/desktop/package.json`, `tauri.conf.json`, `Cargo.toml`
- MVP scope — no mission planning etc.
- Windows desktop build verification: `pnpm build:desktop` in PowerShell
- Parser golden tests belong in Rust first (ADR 0001)

---

## Acceptance criteria (summary)

- [x] Load/configure local DEM (Browse or manual path)
- [x] Live MAVLink → target estimate ≥5 Hz at image center
- [x] UI: lat/lon, ranges, quality, map marker, clear missing-data reasons
- [x] Telemetry from time buffer with configurable video latency
- [x] Unit test: flat terrain known hit
- [x] Local DEM raycast returns plausible point

---

## Agent session notes

- Original grill session produced design Q&A and ADR 0005
- Branch `feat/ground-target-estimation` implements Steps A–H
- Post-implementation polish: native Tauri dialogs, README/handoff sync, MAVLink 265 CRC fix

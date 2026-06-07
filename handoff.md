# Handoff: Ground Target Estimation (DEM Raycast)

**Project:** `uav-ground-control-station`  
**Date:** 2026-06-08  
**Status:** Design grill started — no implementation yet  
**Handoff for:** Fresh agent implementing center-of-image ground target estimation

---

## Goal

Estimate WGS84 coordinates of ground target at **video image center** by:

1. Building camera optical-axis ray from UAV pose + gimbal + camera mount
2. Intersecting ray with local DEM
3. Returning lat/lon, terrain elevation, slant/ground range, quality

Target accuracy: few meters to ~10 m. No object detection, no photogrammetry v1.

Full spec: user message in session (15 sections, Steps A–H). Reference that message; do not duplicate here.

---

## Repo snapshot (what exists)

| Area | State |
|------|--------|
| `TelemetryState` | `packages/shared/src/index.ts` — position, GPS, motion (roll/pitch/yaw), no gimbal, no timestamps per field |
| MAVLink desktop parser | `apps/desktop/src-tauri/src/lib.rs` — HB, SYS_STATUS, GPS_RAW_INT, ATTITUDE, GLOBAL_POSITION_INT, VFR_HUD, etc. **No gimbal messages decoded** |
| Supported MAVLink IDs | Includes 285? Check — list has 285? 241, 245 in list but gimbal IDs (285 GIMBAL_DEVICE_ATTITUDE_STATUS) **not** in `apply_frame` match |
| Geo math | `apps/web/src/lib/geo.ts`, `apps/server/src/services/geo.ts` — haversine only, no ENU |
| DEM / raycast | **None** |
| Video | `apps/web/src/components/VideoPanel.tsx` — external MJPEG/HLS/WebRTC URL, no frame timestamps, no crosshair |
| Tests | `apps/web/src/**/*.test.ts` — replay/preflight only |
| ADR | `docs/adr/0001-dual-runtime-desktop-canonical.md` — desktop Tauri canonical for production; browser+Node dev/fallback |
| Glossary | `CONTEXT.md` — no target-estimation terms yet |

**Version:** `0.2.1` (bump on functional change per project rules)

---

## Planned modules (from spec, not built)

1. **Shared types** — `GimbalState`, `CameraConfig`, `TerrainProvider`, `TargetEstimate`, extended telemetry
2. **Telemetry ring buffer** — 5–10 s, latency-aware lookup + interpolation
3. **Target estimation core** — ray build + terrain intersect (testable, UI-independent)
4. **DEM** — GeoTIFF via backend (Tauri Rust preferred); `TerrainProvider` abstraction
5. **Coordinates** — WGS84 ↔ local ENU; vertical datum config + offset
6. **UI** — target readout, config, map marker + LOS line, video crosshair
7. **Logging/export** — JSON/CSV samples
8. **Tests** — synthetic flat/sloped terrain, horizon reject, missing gimbal/DEM, latency buffer

**Implementation order:** A (types) → B (buffer) → C (core + flat terrain) → D (raycast tests) → E (GeoTIFF) → F (UI) → G (logging) → H (gimbal MAVLink)

---

## Resolved decisions

- **Runtime split (ADR 0005):** Option C — `packages/target-estimation` (math, buffer, tests, synthetic terrain) + `apps/desktop/src-tauri` (GeoTIFF, cache, `estimate_target` command). Real DEM desktop-only v1; browser uses synthetic terrain.
- **Glossary:** Ground target, Target estimate, Terrain model, Gimbal attitude, Camera configuration in `CONTEXT.md`.
- **Gimbal telemetry (Q2):** Option D — unknown/mixed stack. Decode priority `285 → 265 → body-fixed ATTITUDE`. Runtime frame-stats show which IDs arrive. `CameraConfig` convention flags (frame, pitch sign, yaw ref, calibration offsets). No gimbal + body-fixed not enabled → `valid: false`, `quality: bad`, `reason: gimbal_unavailable`.
- **Video time base (Q3):** A + D-ready API. v1: 10 Hz tick, `atPcTimeMs = performance.now() - videoLatencyMs`, buffer lookup by `telemetry.sampledAtMs` (new field; not `lastPacketAt`). API accepts optional explicit `atPcTimeMs` later for frame metadata.
- **Vertical datum (Q4):** A + D-lite. Default `altitudeMode: "amsl"`, `altitudeOffsetM: 0`. Ray origin `altMsl + offset`. Fallback to relative + terrain at UAV → `quality: warn`. No ellipsoid/geoid v1. DEM metadata exposes `verticalDatum`, `horizontalCrs`, `resolutionM`. UI calibration note required.
- **ENU anchor (Q5):** A — per-estimate UAV position at latency-corrected time. `cameraOriginEnu = [0,0,rayOriginZ]`. DEM queries reproject via same anchor. Map LOS uses same estimate's UAV + hit. Tick jitter OK.
- **DEM loading (Q6):** B + batched IPC. Rust sliding window cache (default 4 km × 4 km, recenter at 50% margin). `getElevationsAlongRay(...)` for batched elevation. TS `TauriDemTerrainProvider`. Out of bounds → `dem_out_of_coverage`; nodata → `dem_nodata`.
- **Quality gates (Q7):** Adopt proposed table. Worst-wins aggregation. 3D GPS required for `valid: true`. Body-fixed gimbal when enabled → `warn`. Stale telemetry warn at 500 ms. Horizon min 5° below horizontal. Warn gates still compute/show coords when math allows.
- **UI (Q8):** D — hybrid. VideoPanel: crosshair + compact strip (lat/lon, slant, quality pill). Sidebar sortable "Ground Target" panel: full readout + all config. Map: marker + LOS for valid/warn; hide on bad. Settings `localStorage` `uav-gcs.target.*`. Tauri file picker for DEM desktop.
- **Orchestration (Q9):** B — `TargetEstimationSession` in `packages/target-estimation` owns buffer + estimation. Thin `useTargetEstimation` hook in web. Replay/sim → `target_estimation_live_only`.
- **Logging/export (Q10):** A — in-memory ring 600 samples (~60 s). Slim telemetry slice per sample. Manual JSON/CSV export + clear. Optional Tauri `save_target_log`. No replay pollution; no continuous disk write.

## Resolved decisions summary (10/10)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Runtime split | C — TS core + Rust DEM (ADR 0005) |
| 2 | Gimbal | D — 285→265→body-fixed; runtime discovery |
| 3 | Video time | A + D-ready API; 10 Hz; `sampledAtMs` |
| 4 | Altitude | A + D-lite; amsl default + offset |
| 5 | ENU anchor | Per-estimate UAV position |
| 6 | DEM load | B + `getElevationsAlongRay` IPC; 4 km window |
| 7 | Quality gates | Full table; 3D required; 500 ms stale |
| 8 | UI | D — hybrid video + sidebar + map |
| 9 | Orchestration | `TargetEstimationSession` + thin hook |
| 10 | Logging/export | In-memory ring + manual JSON/CSV export |

**Grill complete.** Ready for implementation Steps A–H per original spec.

## Implementation checklist (Steps A–H)

- [ ] **A** — Shared types: `GimbalState`, `CameraConfig`, `TerrainProvider`, `TargetEstimate`, extend `TelemetryState` with `sampledAtMs` + gimbal
- [ ] **B** — Telemetry ring buffer + timestamp lookup/interpolation in `packages/target-estimation`
- [ ] **C** — `TargetEstimationSession` + synthetic flat terrain
- [ ] **D** — Raycasting + unit tests
- [ ] **E** — Rust GeoTIFF window cache + `get_elevations_along_ray` + `TauriDemTerrainProvider`
- [ ] **F** — UI: VideoPanel overlay, Ground Target sidebar, map marker/LOS
- [ ] **G** — Sample log ring + JSON/CSV export (+ optional `save_target_log`)
- [ ] **H** — MAVLink 285/265 decode + frame stats in Rust

## Artifacts updated this session

- `docs/adr/0005-target-estimation-ts-rust-split.md`
- `CONTEXT.md` — target estimation glossary terms

---

## Key files to touch (when implementing)

```
packages/shared/src/index.ts          # types
packages/target-estimation/         # candidate new package (TBD)
apps/desktop/src-tauri/src/         # MAVLink gimbal, DEM, Tauri commands
apps/web/src/                       # UI, buffer?, map overlay
apps/server/                        # only if browser path needs DEM
CONTEXT.md                          # glossary terms only
docs/adr/                           # if hard runtime split decision
README.md                           # setup, DEM config, operator workflow
```

---

## Constraints (from project rules)

- Desktop canonical for production TX16S/CRSF/COM
- TypeScript in monorepo; shared contracts in `packages/shared`
- Bump version in `package.json`, `apps/desktop/package.json`, `tauri.conf.json`, `Cargo.toml`
- MVP scope — no mission planning etc.
- Windows desktop build verification: `pnpm build:desktop` in PowerShell (agent on macOS may skip — note in PR)
- Parser golden tests belong in Rust first (ADR 0001)

---

## Suggested skills

| Skill | When |
|-------|------|
| `grill-with-docs` | Continue design Q&A; update `CONTEXT.md` as terms lock |
| `caveman` | User wants terse updates |
| `handoff` | Next session boundary |

---

## Acceptance criteria (summary)

- Load/configure local DEM
- Live MAVLink → target estimate ≥5 Hz at image center
- UI: lat/lon, ranges, quality, map marker, clear missing-data reasons
- Telemetry from time buffer with configurable video latency
- Unit test: flat terrain known hit
- Local DEM raycast returns plausible point

---

## Agent session notes

- User invoked `/grill-with-docs /caveman /handoff` with full 15-section spec
- Codebase explored; confirmed gimbal + DEM + raycast are greenfield
- No commits made

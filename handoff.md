# Handoff — Preflight Health Check

**Repo:** `gitfeber/UAVGroundControlStation` (branch `main`, clean at session start)
**Date:** 2026-06-07
**State:** Design fully grilled & resolved. Docs written. **No implementation code written yet.**

## What this is

Add a read-only, operator-facing **Preflight health** panel: a derived readiness status (`READY`/`CAUTION`/`NOT_READY`/`UNKNOWN`) computed purely from existing **active telemetry**. Frontend-only, additive, read-only — no backend/serial/Rust/MAVLink/CRSF changes, no UAV commands.

## Already-written artifacts (do NOT duplicate — read these first for rationale)

- **[docs/adr/0004-preflight-health-advisory.md](../../Documents/Github/UAVGroundControlStation/docs/adr/0004-preflight-health-advisory.md)** — the contract: advisory-only, NOT the FC pre-arm; all-source-mode; freshness gated to live. Repo path: `docs/adr/0004-preflight-health-advisory.md`.
- **CONTEXT.md** (repo root) — canonical terms added this session: **Preflight health**, **Preflight check**, **Telemetry freshness** (distinct from reserved **Telemetry link** = serial connection), **Home reference** (UI first-fix, not FC home).

## Key codebase facts (verified this session)

- `TelemetryState` lives in `packages/shared/src/index.ts`. Fields: top-level `connected`, `lastPacketAt`, `packetCount`; nested `vehicle{armed,...}`, `position`, `gps{fixType,satellites,eph,...}`, `battery{remainingPercent,voltage,cellVoltageEstimate,...}`, `radio{rssi,linkQuality,...}`, `system{sensorsEnabled,sensorsHealth,statusText,...}`, `stats{...}`.
- `apps/web/src/lib/alerts.ts` already hardcodes overlapping thresholds — **leave untouched** (decision: independent preflight thresholds, lower regression risk).
- `home` is NOT in TelemetryState — it's `useState` in `apps/web/src/App.tsx:38`, seeded from first valid coordinate. Must be passed into the pure fn via opts.
- **Staleness landmine:** live `lastPacketAt` = wall-clock; replay/sim `lastPacketAt` = virtual time from 0 (`apps/web/src/replay/simulation.ts:180`, `reconstruct.ts:34`). `Date.now() - lastPacketAt` is meaningless off-live → freshness must be gated to live mode.
- Sidebar cards (`sidebarCardOrder.ts`) are sortable; the Alerts panel is a fixed `Panel` at top, outside the sortable set — mirror that for the new card.
- `apps/web/src/lib/sensorHealth.ts` already has the `(enabled & ~health)` fault logic to reuse.
- `apps/web/src/lib/geo.ts` has `validCoordinate` for the home check.
- Build/verify locally: `& "$env:APPDATA\npm\pnpm.cmd"` (run typecheck + vitest in `apps/web`).

## Full implementation spec

The complete spec (types, exact signature, all thresholds, the 7-check table with band rules, aggregation, summary priority, UI, test list, acceptance) is in the final assistant message of the originating conversation. Reproduced condensed below so this doc is self-sufficient.

### Files
- New: `apps/web/src/lib/preflight.ts` (pure `evaluatePreflightHealth` + types — or put types in `packages/shared`), `apps/web/src/lib/preflightThresholds.ts`, `apps/web/src/lib/preflight.test.ts`, `apps/web/src/components/PreflightHealthCard.tsx`.
- Edit: `apps/web/src/App.tsx` (useMemo + pass down), `apps/web/src/components/TelemetrySidebar.tsx` (render card fixed at top, above Alerts).

### Signature
```ts
evaluatePreflightHealth(
  telemetry: TelemetryState | null | undefined,
  now: number = Date.now(),
  opts: { sourceMode?: 'live'|'replay'|'simulation'; home?: {lat:number;lon:number}|null; thresholds?: Partial<PreflightThresholds> } = {}
): PreflightHealth
```
Pure: no `Date.now()`/`Math.random` inside. Merge `opts.thresholds` over `DEFAULT_PREFLIGHT_THRESHOLDS`.

### Types
`PreflightStatus`, `PreflightCheckResult{ id,label,status,message,details?,optional?,updatedAt? }`, `PreflightHealth{ status,checks,summary,updatedAt }`, `PreflightThresholds`.

### Thresholds (defaults)
`telemetryMaxAgeMs:3000, minGpsSatellitesReady:8, minGpsSatellitesCaution:5, minBatteryPercentReady:25, minBatteryPercentCaution:15, minLinkQualityReady:70, minLinkQualityCaution:40, maxEphReady:200`.

### No-telemetry gate (short-circuit)
`if (!telemetry || telemetry.packetCount === 0 || telemetry.lastPacketAt == null)` → return UNKNOWN, summary `"Waiting for telemetry"`, but still emit all 7 check rows as UNKNOWN. **Note: `packetCount` is top-level, NOT `stats.packetCount`** (the originating chat's snippet had this wrong — use `telemetry.packetCount`).

### Checks (id | label | rules)
1. `telemetry-freshness` | "Telemetry freshness" | live: `now-lastPacketAt > telemetryMaxAgeMs` → NOT_READY else READY. replay/sim: `optional:true`, UNKNOWN, "Freshness check skipped outside live mode".
2. `gps` | "GPS" | `fixType==null||<2`→NOT_READY; `==2`→CAUTION; `>=3`: sats≥8 READY / 5–7 CAUTION / **<5 NOT_READY**. eph present & `>maxEphReady` → downgrade READY→CAUTION only (never NOT_READY).
3. `battery` | "Battery" | `remainingPercent` ≥25 READY / 15–<25 CAUTION / <15 NOT_READY; null→CAUTION blocking ("Battery level unavailable"). No voltage inference.
4. `radio` | "Radio / Link" | `linkQuality` ≥70 READY / 40–<70 CAUTION / <40 NOT_READY; null→CAUTION blocking ("Link quality unavailable"). Never interpret raw RSSI for status (RSSI → details only).
5. `home` | "Home reference (first fix)" | `home==null`→CAUTION; invalid/null-island(0,0 or fails `validCoordinate`)→NOT_READY; valid→READY.
6. `armed` | "Armed state" | `armed===true`→CAUTION; false→READY; missing→`optional` UNKNOWN.
7. `system-health` | "System health" | `(sensorsEnabled & ~sensorsHealth)!==0`→NOT_READY; healthy→READY; missing bitmask→`optional` UNKNOWN. No statusText keyword scan (statusText→details only).

### Aggregation
non-optional NOT_READY → NOT_READY; else non-optional CAUTION → CAUTION; else non-optional UNKNOWN → UNKNOWN; else READY. Optional checks' UNKNOWN is excluded from aggregation.

### Summary
READY → "Ready for flight". Else pick dominant-status check by fixed priority `battery > gps > radio > telemetry-freshness > system-health > home > armed`; format `"Not ready: <msg>"` / `"Caution: <msg>"`. Empty gate → "Waiting for telemetry".

### UI
`PreflightHealthCard` = fixed `Panel` at top of `TelemetrySidebar`, above Alerts (not sortable). Big global badge + summary + compact check list. Colors: READY emerald, CAUTION amber, NOT_READY red, UNKNOWN slate. Reuse existing `Badge`/`Panel`/`tone`. Must not throw on missing fields. App: `useMemo(() => evaluatePreflightHealth(telemetry, Date.now(), { sourceMode: activeSourceMode, home }), [telemetry, activeSourceMode, home])`, pass to sidebar.

### Tests (Vitest, pure fn)
no telemetry→UNKNOWN; all-good→READY; GPS no fix→NOT_READY; battery <15→NOT_READY & 15–24→CAUTION; link <40→NOT_READY; live stale→NOT_READY; **replay stale timestamps must NOT make global NOT_READY**; mixed severities→correct dominant+summary; missing battery/link→CAUTION; missing sensors→optional UNKNOWN not blocking READY.

### Decisions deferred (out of scope v1)
- Activity-log status-change logging (would require exposing `addLog` from `useTelemetry` — skipped).
- Unifying preflight thresholds with `alerts.ts` (reversible, later).

## Acceptance
Global status + visible checks + missing-telemetry safe + critical→NOT_READY + borderline→CAUTION + good→READY + pure fn w/ tests + read-only/no commands + map/HUD/sidebar/replay/logging intact + typecheck & tests pass.

## Suggested skills for next session
- **caveman** — user was running caveman mode this session; keep responses compressed.
- **verify** or **run** — after implementing, launch the app to confirm the card renders and behaves across live/replay/simulation modes.
- **code-review** — review the diff before PR (correctness + reuse/simplification).
- **security-review** — minor; feature is read-only, but confirms no command/serial path was added.

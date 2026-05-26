# Dual runtime with desktop as canonical link layer

UAV GCS ships two ways to open a serial port: Tauri desktop (`apps/desktop`, Rust) and browser + Node (`apps/server` + `apps/web`). TX16S operators on Windows need host `COM*` access and CRSF telemetry at 420000 baud, which only the desktop stack implements today (CRSF parse, passthrough MAVLink, GCS wake-up). The Node server path is MAVLink-only and passive on TX (`txBytes` stays 0).

**Decision:** Treat **desktop as the canonical production runtime** for TX16S / CRSF / Windows `COM*`. Keep the **browser + Node stack as a supported dev and fallback path** for MAVLink-direct links and UI work, not as a first-class TX16S product surface until product explicitly promotes it.

**Consequences:** Do not port CRSF or GCS wake-up into `apps/server` without a product decision and ADR update. Shared `TelemetryState` and status field names may stay MAVLink-oriented in code while UI copy stays protocol-neutral. Parser golden tests belong in Rust first (`apps/desktop/src-tauri`).

**Status:** accepted (2026-05-26)

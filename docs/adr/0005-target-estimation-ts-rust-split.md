# Target estimation: TS core with Rust DEM I/O

Ground-target estimation (camera optical-axis ray intersected with a local DEM) splits across the monorepo: pure math and testable logic live in `packages/target-estimation`; GeoTIFF/DGM loading, tile cache, and filesystem-backed elevation queries live in `apps/desktop/src-tauri` behind Tauri commands. Browser/web dev uses synthetic or flat terrain providers only — no real DEM in v1.

**Decision:** Reject all-Rust (hurts TS unit tests and web iteration) and all-TS (large EPSG:25832 projected DEM GeoTIFF does not belong in browser/Node dev). Desktop remains the only production path for real terrain data, consistent with ADR 0001.

**Status:** accepted (2026-06-08)

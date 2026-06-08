export function isTauriDesktop(): boolean {
  return Boolean(window.__TAURI_INTERNALS__);
}

export async function pickTerrainModelPath(): Promise<string | null> {
  if (!isTauriDesktop()) return null;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: "GeoTIFF",
        extensions: ["tif", "tiff"]
      }
    ]
  });

  if (selected === null) return null;
  return typeof selected === "string" ? selected : (selected[0] ?? null);
}

export async function pickTargetLogSavePath(format: "json" | "csv"): Promise<string | null> {
  if (!isTauriDesktop()) return null;

  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({
    defaultPath: format === "csv" ? "target-log.csv" : "target-log.json",
    filters: [
      {
        name: format === "csv" ? "CSV" : "JSON",
        extensions: [format]
      }
    ]
  });
}

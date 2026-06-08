export function downloadTextFile(filename: string, contents: string, mimeType: string): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function targetSampleLogFilename(extension: "json" | "csv", atMs: number = Date.now()): string {
  const stamp = new Date(atMs).toISOString().replaceAll(":", "-").replace(/\..+$/, "");
  return `uav-gcs-target-log-${stamp}.${extension}`;
}

export type StoppedLogSourceKind = "disk" | "buffer";

export interface StoppedLogPayload {
  text: string;
  fileName: string;
  source: StoppedLogSourceKind;
}

export function canOfferLogReplayHandoff(input: {
  runtimeMode: "web" | "desktop" | "cloud";
  loggingActive: boolean;
  loggingFilePath: string | null;
  sessionEventCount: number;
  liveControlsLocked: boolean;
}): boolean {
  if (input.liveControlsLocked) {
    return false;
  }

  if (input.runtimeMode === "cloud") {
    return input.sessionEventCount > 0;
  }

  if (!input.loggingActive && input.loggingFilePath) {
    return true;
  }

  if (input.runtimeMode === "web" && input.sessionEventCount > 0) {
    return true;
  }

  return false;
}

export function fileNameFromLogPath(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || "session.jsonl";
}

export function jsonlByteLength(text: string): number {
  return new Blob([text]).size;
}

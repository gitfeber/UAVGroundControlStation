export function formatNumber(value: number | null | undefined, digits = 1, suffix = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value.toFixed(digits)}${suffix}`;
}

export function formatInteger(value: number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${Math.round(value)}${suffix}`;
}

export function packetAge(lastPacketAt: number | null): string {
  if (lastPacketAt === null) return "--";
  const ageMs = Date.now() - lastPacketAt;
  if (ageMs < 1000) return `${ageMs}ms`;
  return `${(ageMs / 1000).toFixed(1)}s`;
}

export function elapsedTime(startedAt: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function percentageColor(value: number | null): string {
  if (value === null) return "bg-slate-700";
  if (value > 50) return "bg-emerald-400";
  if (value >= 25) return "bg-yellow-300";
  return "bg-red-500";
}

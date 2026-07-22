const PROGRESS_SEQUENCE = [
  { at: 0, value: 0 },
  { at: 180, value: 7 },
  { at: 360, value: 18 },
  { at: 620, value: 31 },
  { at: 900, value: 46 },
  { at: 1180, value: 58 },
  { at: 1450, value: 73 },
  { at: 1700, value: 81 },
  { at: 1950, value: 92 },
  { at: 2200, value: 100 }
] as const;

export function progressAtElapsed(elapsedMs: number, sequence = PROGRESS_SEQUENCE): number {
  if (elapsedMs <= sequence[0].at) return sequence[0].value;

  for (let i = sequence.length - 1; i >= 0; i -= 1) {
    const current = sequence[i];
    if (!current || elapsedMs < current.at) continue;

    const next = sequence[i + 1];
    if (!next) return current.value;

    const span = next.at - current.at;
    if (span <= 0) return current.value;

    const t = (elapsedMs - current.at) / span;
    return current.value + t * (next.value - current.value);
  }

  return 0;
}

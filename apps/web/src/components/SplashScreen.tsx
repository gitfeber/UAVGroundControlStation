import { useEffect, useMemo, useRef, useState } from "react";
import { appVersionLabel } from "../lib/appVersion";

// Future improvement: replace in-app desktop splash with a dedicated transparent
// frameless Tauri splash window that closes when the main webview is ready.

const BOOT_STEPS = [
  "INIT: CORE SYSTEMS",
  "INIT: UI FRAMEWORK",
  "INIT: MAP ENGINE",
  "INIT: TELEMETRY INTERFACE",
  "INIT: OPERATOR DASHBOARD",
  "INIT: REPLAY SYSTEM",
  "INIT: SAFETY MONITORS"
] as const;

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

const SPLASH_FADE_MS = 350;
const TITLE_APPEAR_MS = 200;
const PROGRESS_START_MS = 300;
const BOOT_LINES_START_MS = 400;
const BOOT_LINE_INTERVAL_MS = 250;
const SYSTEMS_READY_MS = 2300;
const FADE_START_MS = 2400;

const REDUCED_MOTION_TOTAL_MS = 700;
const REDUCED_MOTION_FADE_MS = 200;

export interface SplashScreenProps {
  onDone?: () => void;
  enabled?: boolean;
}

type SplashPhase = "visible" | "fading" | "hidden";

type BootLineStatus = "pending" | "active" | "ok";

interface BootLine {
  label: string;
  status: BootLineStatus;
}

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

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function buildBootLines(activeIndex: number, completedThrough: number): BootLine[] {
  return BOOT_STEPS.map((label, index): BootLine => {
    if (index <= completedThrough) {
      return { label, status: "ok" };
    }
    if (index === activeIndex) {
      return { label, status: "active" };
    }
    return { label, status: "pending" };
  }).filter((line) => line.status !== "pending");
}

export function SplashScreen({ onDone, enabled = true }: SplashScreenProps) {
  const [phase, setPhase] = useState<SplashPhase>("visible");
  const [brandVisible, setBrandVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [bootLines, setBootLines] = useState<BootLine[]>([]);
  const [systemsReady, setSystemsReady] = useState(false);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!enabled) {
      onDoneRef.current?.();
      return;
    }

    let cancelled = false;
    const timers: number[] = [];
    let rafId = 0;
    const startedAt = performance.now();

    const schedule = (delay: number, fn: () => void) => {
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) fn();
        }, delay)
      );
    };

    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      setPhase("hidden");
      onDoneRef.current?.();
    };

    if (reducedMotion) {
      setBrandVisible(true);
      setProgress(100);
      setBootLines(BOOT_STEPS.map((label) => ({ label, status: "ok" })));
      setSystemsReady(true);

      schedule(REDUCED_MOTION_TOTAL_MS - REDUCED_MOTION_FADE_MS, () => setPhase("fading"));
      schedule(REDUCED_MOTION_TOTAL_MS, finish);

      return () => {
        cancelled = true;
        timers.forEach((timer) => window.clearTimeout(timer));
      };
    }

    schedule(TITLE_APPEAR_MS, () => setBrandVisible(true));

    const tickProgress = () => {
      const elapsed = performance.now() - startedAt;
      setProgress(progressAtElapsed(elapsed));
      if (elapsed < FADE_START_MS) {
        rafId = window.requestAnimationFrame(tickProgress);
      } else {
        setProgress(100);
      }
    };

    schedule(PROGRESS_START_MS, () => {
      tickProgress();
    });

    BOOT_STEPS.forEach((_label, index) => {
      const appearAt = BOOT_LINES_START_MS + index * BOOT_LINE_INTERVAL_MS;
      const completeAt = appearAt + BOOT_LINE_INTERVAL_MS - 40;

      schedule(appearAt, () => {
        setBootLines(buildBootLines(index, index - 1));
      });

      schedule(completeAt, () => {
        setBootLines(buildBootLines(index + 1, index));
      });
    });

    schedule(SYSTEMS_READY_MS, () => setSystemsReady(true));
    schedule(FADE_START_MS, () => setPhase("fading"));
    schedule(FADE_START_MS + SPLASH_FADE_MS, finish);

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [enabled, reducedMotion]);

  if (!enabled || phase === "hidden") {
    return null;
  }

  const progressLabel = `${Math.round(progress)}%`;

  return (
    <div
      className={`splash-screen ${phase === "fading" ? "splash-screen--fading" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="Starting UAV Ground Control Station"
      data-reduced-motion={reducedMotion ? "true" : "false"}
    >
      <div className="splash-background-grid" aria-hidden="true" />
      <div className="splash-hud-rings" aria-hidden="true" />
      <div className="splash-hud-corner splash-hud-corner--tl" aria-hidden="true" />
      <div className="splash-hud-corner splash-hud-corner--tr" aria-hidden="true" />
      <div className="splash-hud-corner splash-hud-corner--bl" aria-hidden="true" />
      <div className="splash-hud-corner splash-hud-corner--br" aria-hidden="true" />
      <div className="splash-hud-scale splash-hud-scale--left" aria-hidden="true" />
      <div className="splash-hud-scale splash-hud-scale--right" aria-hidden="true" />

      <div className="splash-content">
        <div className={`splash-brand ${brandVisible ? "splash-brand--visible" : ""}`}>
          <h1 className="splash-title">UAV</h1>
          <p className="splash-subtitle">Ground Control Station</p>
          <p className="splash-version">{appVersionLabel()}</p>
          <div className="splash-brand-divider" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>

        <div className="splash-boot">
          <div className="splash-boot-header">Booting Systems</div>
          <div className="splash-progress-row">
            <div className="splash-progress" aria-hidden="true">
              <div className="splash-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="splash-progress-value">{progressLabel}</span>
          </div>

          <div className="splash-boot-lines">
            {bootLines.map((line) => (
              <div key={line.label} className="splash-boot-line">
                <span className="splash-boot-label">{line.label}</span>
                <span className={`splash-boot-status splash-boot-status--${line.status}`}>
                  {line.status === "ok" ? "OK" : "..."}
                </span>
              </div>
            ))}
            {systemsReady && (
              <div className="splash-boot-line splash-boot-line--ready">
                <span className="splash-boot-label">SYSTEMS READY</span>
                <span className="splash-boot-status splash-boot-status--ok">OK</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="splash-footer-coords" aria-hidden="true">
        37.7749° N, 122.4194° W
      </div>
    </div>
  );
}

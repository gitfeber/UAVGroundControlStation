import { useEffect, useMemo, useRef, useState } from "react";
import { appVersionLabel } from "../lib/appVersion";
import { progressAtElapsed } from "../lib/splashProgress";

// Future improvement: replace in-app desktop splash with a dedicated transparent
// frameless Tauri splash window that closes when the main webview is ready.

const SPLASH_FADE_MS = 350;
const TITLE_APPEAR_MS = 200;
const PROGRESS_START_MS = 300;
const FADE_START_MS = 2400;

const REDUCED_MOTION_TOTAL_MS = 700;
const REDUCED_MOTION_FADE_MS = 200;

export interface SplashScreenProps {
  onDone?: () => void;
  enabled?: boolean;
}

type SplashPhase = "visible" | "fading" | "hidden";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SplashScreen({ onDone, enabled = true }: SplashScreenProps) {
  const [phase, setPhase] = useState<SplashPhase>("visible");
  const [brandVisible, setBrandVisible] = useState(false);
  const [progress, setProgress] = useState(0);
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
      <div className="splash-content">
        <div className={`splash-brand ${brandVisible ? "splash-brand--visible" : ""}`}>
          <h1 className="splash-title">UAV</h1>
          <p className="splash-subtitle">Ground Control Station</p>
          <p className="splash-version">{appVersionLabel()}</p>
        </div>

        <div className="splash-boot">
          <div className="splash-boot-header">Loading operator console</div>
          <div className="splash-progress-row">
            <div className="splash-progress" aria-hidden="true">
              <div className="splash-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="splash-progress-value">{progressLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

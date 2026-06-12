import { useEffect, useRef } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { buildOnboardingSteps } from "../lib/onboardingSteps";
import {
  clearOnboardingCompletion,
  hasCompletedOnboarding,
  markOnboardingComplete,
  prefersReducedMotion
} from "../lib/onboarding";
import type { RuntimeMode } from "../lib/runtimeMode";

interface OnboardingTourProps {
  active: boolean;
  runtimeMode: RuntimeMode;
  restartToken: number;
}

export function OnboardingTour({ active, runtimeMode, restartToken }: OnboardingTourProps) {
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    driverRef.current?.destroy();

    const manualRestart = restartToken > 0;
    if (manualRestart) {
      clearOnboardingCompletion();
    } else if (hasCompletedOnboarding()) {
      return;
    }

    const timer = window.setTimeout(() => {
      const steps = filterVisibleSteps(buildOnboardingSteps(runtimeMode));
      if (steps.length === 0) {
        return;
      }

      const driverObj = driver({
        animate: !prefersReducedMotion(),
        showProgress: true,
        progressText: "{{current}} of {{total}}",
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Done",
        allowClose: true,
        overlayOpacity: 0.62,
        stagePadding: 8,
        stageRadius: 10,
        popoverClass: "gcs-driver-popover",
        overlayColor: "#020617",
        showButtons: ["previous", "next", "close"],
        steps,
        onPopoverRender: (popover) => {
          popover.closeButton.textContent = "Skip tour";
          popover.closeButton.setAttribute("aria-label", "Skip onboarding tour");
        },
        onDestroyed: () => {
          markOnboardingComplete();
          driverRef.current = null;
        }
      });

      driverRef.current = driverObj;
      driverObj.drive();
    }, 450);

    return () => {
      window.clearTimeout(timer);
      driverRef.current?.destroy();
      driverRef.current = null;
    };
  }, [active, runtimeMode, restartToken]);

  return null;
}

function filterVisibleSteps(steps: DriveStep[]): DriveStep[] {
  return steps.filter((step) => {
    if (!step.element) {
      return true;
    }

    if (typeof step.element === "function") {
      return Boolean(step.element());
    }

    if (typeof step.element === "string") {
      return document.querySelector(step.element) !== null;
    }

    return document.contains(step.element);
  });
}

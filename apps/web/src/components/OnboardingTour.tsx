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
        stagePadding: 5,
        stageRadius: 2,
        popoverOffset: 10,
        popoverClass: "gcs-driver-popover",
        overlayColor: "#080b0d",
        showButtons: ["previous", "next"],
        steps,
        onPopoverRender: (popover) => {
          styleTourSkipControl(popover);
          clampPopoverToViewport(popover.wrapper);
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

function styleTourSkipControl(popover: {
  closeButton: HTMLButtonElement;
  title: HTMLElement;
  wrapper: HTMLElement;
}): void {
  popover.closeButton.textContent = "Skip";
  popover.closeButton.setAttribute("aria-label", "Skip onboarding tour");
  popover.closeButton.classList.add("gcs-driver-skip");

  popover.title.classList.add("gcs-driver-popover-title-row");
  popover.wrapper.classList.add("gcs-driver-popover-shell");
}

function clampPopoverToViewport(wrapper: HTMLElement, margin = 12): void {
  const rect = wrapper.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top;

  if (rect.right > window.innerWidth - margin) {
    left -= rect.right - (window.innerWidth - margin);
  }
  if (rect.left < margin) {
    left += margin - rect.left;
  }
  if (rect.bottom > window.innerHeight - margin) {
    top -= rect.bottom - (window.innerHeight - margin);
  }
  if (rect.top < margin) {
    top += margin - rect.top;
  }

  if (left !== rect.left) {
    wrapper.style.left = `${Math.round(left)}px`;
  }
  if (top !== rect.top) {
    wrapper.style.top = `${Math.round(top)}px`;
  }
}

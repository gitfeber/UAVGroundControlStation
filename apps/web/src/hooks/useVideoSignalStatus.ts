import { useCallback, useEffect, useRef, useState } from "react";

export type VideoSignalStatus = "none" | "connecting" | "good" | "error";

const STALE_MS = 8_000;

export function isVideoSignalGood(status: VideoSignalStatus): boolean {
  return status === "good";
}

export interface VideoSignalController {
  status: VideoSignalStatus;
  markFrame: () => void;
  markConnecting: () => void;
  markError: () => void;
}

/** Tracks whether the configured video stream is actively delivering frames. */
export function useVideoSignalStatus(url: string, kind: "mjpeg" | "hls" | "webrtc"): VideoSignalController {
  const [status, setStatus] = useState<VideoSignalStatus>(() => (url ? "connecting" : "none"));
  const lastFrameAtRef = useRef<number | null>(null);

  useEffect(() => {
    lastFrameAtRef.current = null;
    setStatus(url ? "connecting" : "none");
  }, [url, kind]);

  useEffect(() => {
    if (status !== "good") return;

    const timer = window.setInterval(() => {
      const last = lastFrameAtRef.current;
      if (last !== null && Date.now() - last > STALE_MS) {
        setStatus("error");
      }
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [status]);

  const markFrame = useCallback(() => {
    lastFrameAtRef.current = Date.now();
    setStatus("good");
  }, []);

  const markConnecting = useCallback(() => {
    setStatus((current) => (current === "good" ? current : "connecting"));
  }, []);

  const markError = useCallback(() => {
    setStatus("error");
  }, []);

  return { status, markFrame, markConnecting, markError };
}

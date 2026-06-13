import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { TelemetryState } from "@uav-ground-control-station/shared";
import type { TargetEstimationController } from "../hooks/useTargetEstimation";
import { isVideoSignalGood, useVideoSignalStatus } from "../hooks/useVideoSignalStatus";
import { sanitizeHttpUrl } from "../lib/safeHttpUrl";
import { GroundTargetPanel } from "./GroundTargetPanel";
import { HudOverlay } from "./HudOverlay";

type VideoKind = "mjpeg" | "hls" | "webrtc";

const defaultUrl = sanitizeHttpUrl(import.meta.env.VITE_VIDEO_URL ?? "");
const defaultKind = (import.meta.env.VITE_VIDEO_KIND as VideoKind | undefined) ?? "mjpeg";
const VIDEO_HUD_KEY = "uav-gcs.video.hud";

function loadVideoHudEnabled(): boolean {
  const raw = localStorage.getItem(VIDEO_HUD_KEY);
  return raw === null ? true : raw === "true";
}

interface VideoPanelProps {
  telemetry: TelemetryState;
  telemetryStale?: boolean;
  targetEstimation: TargetEstimationController;
}

export function VideoPanel({ telemetry, telemetryStale = false, targetEstimation }: VideoPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [url, setUrl] = useState(() => sanitizeHttpUrl(localStorage.getItem("uav-gcs.video.url") ?? defaultUrl));
  const [kind, setKind] = useState<VideoKind>(() => (localStorage.getItem("uav-gcs.video.kind") as VideoKind | null) ?? defaultKind);
  const [showHud, setShowHud] = useState(() => loadVideoHudEnabled());
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const videoSignal = useVideoSignalStatus(url, kind);
  const showGroundTarget = !collapsed && isVideoSignalGood(videoSignal.status);

  useEffect(() => {
    localStorage.setItem("uav-gcs.video.url", url);
    localStorage.setItem("uav-gcs.video.kind", kind);
  }, [url, kind]);

  useEffect(() => {
    localStorage.setItem(VIDEO_HUD_KEY, String(showHud));
  }, [showHud]);

  useEffect(() => {
    function move(event: globalThis.PointerEvent) {
      const offset = dragOffsetRef.current;
      if (!offset) return;
      setPosition({
        x: Math.max(8, Math.min(window.innerWidth - 380, event.clientX - offset.x)),
        y: Math.max(72, Math.min(window.innerHeight - 260, event.clientY - offset.y))
      });
    }

    function stop() {
      dragOffsetRef.current = null;
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, []);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    dragOffsetRef.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    };
  }

  const style: CSSProperties = position
    ? { left: position.x, top: position.y }
    : { right: 24, bottom: 24 };

  return (
    <div className="absolute z-20 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2 sm:flex-row sm:items-end" style={style}>
      {showGroundTarget && (
        <div className="w-full max-h-[min(50vh,420px)] shrink-0 overflow-y-auto rounded-xl border border-cyan-300/20 bg-slate-950/88 shadow-glow backdrop-blur sm:w-[300px] sm:max-h-[min(70vh,520px)]">
          <GroundTargetPanel {...targetEstimation} />
        </div>
      )}

      <section
        data-tour="camera-feed"
        className="w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-cyan-300/20 bg-slate-950/88 shadow-glow backdrop-blur"
      >
        <header className="flex cursor-move items-center justify-between border-b border-line px-3 py-2" onPointerDown={startDrag}>
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-cyan-200">Camera Feed</div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>{kind.toUpperCase()}</span>
              <VideoSignalBadge status={videoSignal.status} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`rounded border px-2 py-1 text-xs transition ${
                showHud
                  ? "border-cyan-300/40 bg-cyan-500/15 text-cyan-100"
                  : "border-white/10 text-slate-300 hover:border-cyan-300/40"
              }`}
              aria-pressed={showHud}
              onClick={() => setShowHud((value) => !value)}
            >
              HUD
            </button>
            <button className="rounded border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-cyan-300/40" onClick={() => setCollapsed((value) => !value)}>
              {collapsed ? "Open" : "Hide"}
            </button>
          </div>
        </header>

        {!collapsed && (
          <>
            <div className="relative h-[220px] bg-black">
              {url ? (
                <VideoContent url={url} kind={kind} signal={videoSignal} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">No video source configured</div>
              )}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-10 w-10 rounded-full border border-cyan-200/70" />
                <div className="absolute h-12 w-px bg-cyan-200/70" />
                <div className="absolute h-px w-12 bg-cyan-200/70" />
              </div>
              {showHud && (
                <div className="pointer-events-none absolute left-1 top-1 z-10 scale-[0.72] origin-top-left opacity-90 sm:scale-[0.78]">
                  <HudOverlay telemetry={telemetry} stale={telemetryStale} compact showTourTarget={false} />
                </div>
              )}
            </div>
            <div className="grid grid-cols-[90px_1fr] gap-2 border-t border-line p-2">
              <select className="input-dark" value={kind} onChange={(event) => setKind(event.target.value as VideoKind)}>
                <option value="mjpeg">MJPEG</option>
                <option value="hls">HLS</option>
                <option value="webrtc">WebRTC</option>
              </select>
              <input
                className="input-dark"
                value={url}
                onChange={(event) => setUrl(sanitizeHttpUrl(event.target.value))}
                placeholder="Video URL (http/https)"
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function VideoSignalBadge({ status }: { status: ReturnType<typeof useVideoSignalStatus>["status"] }) {
  const label =
    status === "good" ? "Live" : status === "connecting" ? "Connecting" : status === "error" ? "No signal" : "No URL";
  const tone =
    status === "good"
      ? "text-emerald-300"
      : status === "connecting"
        ? "text-amber-200"
        : status === "error"
          ? "text-red-300"
          : "text-slate-500";

  return <span className={`font-mono text-[10px] uppercase tracking-wider ${tone}`}>{label}</span>;
}

function VideoContent({
  url,
  kind,
  signal
}: {
  url: string;
  kind: VideoKind;
  signal: ReturnType<typeof useVideoSignalStatus>;
}) {
  const safeUrl = sanitizeHttpUrl(url);
  if (!safeUrl) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-500">Invalid or unsupported video URL</div>;
  }

  if (kind === "mjpeg") {
    return (
      <img
        className="h-full w-full object-cover"
        src={safeUrl}
        alt="Camera feed"
        onLoad={() => signal.markFrame()}
        onError={() => signal.markError()}
      />
    );
  }

  if (kind === "hls") {
    return (
      <video
        className="h-full w-full object-cover"
        src={safeUrl}
        controls
        muted
        playsInline
        autoPlay
        onLoadedData={() => signal.markFrame()}
        onTimeUpdate={(event) => {
          if (event.currentTarget.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            signal.markFrame();
          }
        }}
        onWaiting={() => signal.markConnecting()}
        onError={() => signal.markError()}
      />
    );
  }

  return (
    <div className="flex h-full items-center justify-center px-8 text-center text-sm text-slate-500">
      WebRTC placeholder. Add a signaling client here when the air unit or capture bridge is available.
    </div>
  );
}

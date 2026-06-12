import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { TargetEstimate } from "@uav-ground-control-station/shared";
import { formatNumber } from "../lib/format";
import { sanitizeHttpUrl } from "../lib/safeHttpUrl";
import { Badge } from "./Panel";

type VideoKind = "mjpeg" | "hls" | "webrtc";

const defaultUrl = sanitizeHttpUrl(import.meta.env.VITE_VIDEO_URL ?? "");
const defaultKind = (import.meta.env.VITE_VIDEO_KIND as VideoKind | undefined) ?? "mjpeg";

interface VideoPanelProps {
  estimate: TargetEstimate | null;
}

export function VideoPanel({ estimate }: VideoPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [url, setUrl] = useState(() => sanitizeHttpUrl(localStorage.getItem("uav-gcs.video.url") ?? defaultUrl));
  const [kind, setKind] = useState<VideoKind>(() => (localStorage.getItem("uav-gcs.video.kind") as VideoKind | null) ?? defaultKind);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    localStorage.setItem("uav-gcs.video.url", url);
    localStorage.setItem("uav-gcs.video.kind", kind);
  }, [url, kind]);

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
    <section data-tour="camera-feed" className="absolute z-20 w-[360px] overflow-hidden rounded-xl border border-cyan-300/20 bg-slate-950/88 shadow-glow backdrop-blur" style={style}>
      <header className="flex cursor-move items-center justify-between border-b border-line px-3 py-2" onPointerDown={startDrag}>
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-cyan-200">Camera Feed</div>
          <div className="text-xs text-slate-500">{kind.toUpperCase()}</div>
        </div>
        <button className="rounded border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-cyan-300/40" onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? "Open" : "Hide"}
        </button>
      </header>

      {!collapsed && (
        <>
          <div className="relative h-[220px] bg-black">
            {url ? <VideoContent url={url} kind={kind} /> : <div className="flex h-full items-center justify-center text-sm text-slate-500">No video source configured</div>}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-10 w-10 rounded-full border border-cyan-200/70" />
              <div className="absolute h-12 w-px bg-cyan-200/70" />
              <div className="absolute h-px w-12 bg-cyan-200/70" />
            </div>
            <VideoTargetStrip estimate={estimate} />
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
  );
}

function VideoTargetStrip({ estimate }: { estimate: TargetEstimate | null }) {
  const showCoords = estimate && (estimate.valid || estimate.quality === "warn") && estimate.lat !== null && estimate.lon !== null;
  const tone = estimate?.quality === "good" ? "good" : estimate?.quality === "warn" ? "warn" : "bad";

  return (
    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 border-t border-cyan-300/20 bg-slate-950/85 px-2 py-1.5 text-[10px]">
      <div className="min-w-0 truncate font-mono text-slate-200">
        {showCoords ? `${formatNumber(estimate.lat, 5)}, ${formatNumber(estimate.lon, 5)}` : "Target --"}
      </div>
      <div className="shrink-0 font-mono text-slate-400">{formatNumber(estimate?.slantRangeM, 0, " m")}</div>
      <Badge tone={estimate ? tone : "neutral"}>{estimate?.quality ?? "idle"}</Badge>
    </div>
  );
}

function VideoContent({ url, kind }: { url: string; kind: VideoKind }) {
  const safeUrl = sanitizeHttpUrl(url);
  if (!safeUrl) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-500">Invalid or unsupported video URL</div>;
  }

  if (kind === "mjpeg") {
    return <img className="h-full w-full object-cover" src={safeUrl} alt="Camera feed" />;
  }

  if (kind === "hls") {
    return <video className="h-full w-full object-cover" src={safeUrl} controls muted playsInline />;
  }

  return (
    <div className="flex h-full items-center justify-center px-8 text-center text-sm text-slate-500">
      WebRTC placeholder. Add a signaling client here when the air unit or capture bridge is available.
    </div>
  );
}

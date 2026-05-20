import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

type VideoKind = "mjpeg" | "hls" | "webrtc";

const defaultUrl = import.meta.env.VITE_VIDEO_URL ?? "";
const defaultKind = (import.meta.env.VITE_VIDEO_KIND as VideoKind | undefined) ?? "mjpeg";

export function VideoPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [url, setUrl] = useState(() => localStorage.getItem("uav-gcs.video.url") ?? defaultUrl);
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
    <section className="absolute z-20 w-[360px] overflow-hidden rounded-xl border border-cyan-300/20 bg-slate-950/88 shadow-glow backdrop-blur" style={style}>
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
          <div className="h-[220px] bg-black">
            {url ? <VideoContent url={url} kind={kind} /> : <div className="flex h-full items-center justify-center text-sm text-slate-500">No video source configured</div>}
          </div>
          <div className="grid grid-cols-[90px_1fr] gap-2 border-t border-line p-2">
            <select className="input-dark" value={kind} onChange={(event) => setKind(event.target.value as VideoKind)}>
              <option value="mjpeg">MJPEG</option>
              <option value="hls">HLS</option>
              <option value="webrtc">WebRTC</option>
            </select>
            <input className="input-dark" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Video URL" />
          </div>
        </>
      )}
    </section>
  );
}

function VideoContent({ url, kind }: { url: string; kind: VideoKind }) {
  if (kind === "mjpeg") {
    return <img className="h-full w-full object-cover" src={url} alt="Camera feed" />;
  }

  if (kind === "hls") {
    return <video className="h-full w-full object-cover" src={url} controls muted playsInline />;
  }

  return (
    <div className="flex h-full items-center justify-center px-8 text-center text-sm text-slate-500">
      WebRTC placeholder. Add a signaling client here when the air unit or capture bridge is available.
    </div>
  );
}

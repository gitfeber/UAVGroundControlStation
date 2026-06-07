import { useEffect, useMemo, useState } from "react";
import { getAlerts } from "./lib/alerts";
import { evaluatePreflightHealth } from "./lib/preflight";
import { haversineDistanceM, type Coordinate, validCoordinate } from "./lib/geo";
import { packetAge } from "./lib/format";
import { useTelemetrySource } from "./hooks/useTelemetrySource";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MapPanel } from "./components/MapPanel";
import { TelemetrySidebar } from "./components/TelemetrySidebar";
import { Topbar } from "./components/Topbar";
import { VideoPanel } from "./components/VideoPanel";
import { ActivityLogPanel } from "./components/ActivityLogPanel";
import { ReplaySimPanel } from "./components/ReplaySimPanel";

export function App() {
  const {
    telemetry,
    status,
    loggingStatus,
    ports,
    logs,
    error,
    wsConnected,
    runtimeMode,
    refreshPorts,
    connect,
    disconnect,
    resetSession,
    startLogging,
    stopLogging,
    clearLogs,
    activeSourceMode,
    setSourceMode,
    liveControlsLocked,
    liveConnectedInBackground,
    replay
  } = useTelemetrySource();

  const [home, setHome] = useState<Coordinate | null>(null);
  const coordinate = validCoordinate(telemetry.position?.lat, telemetry.position?.lon);
  const isControlledTrack = activeSourceMode !== "live";

  useEffect(() => {
    if (!home && coordinate) {
      setHome({ lat: coordinate.lat, lon: coordinate.lon });
    }
  }, [coordinate, home]);

  async function resetAll() {
    setHome(null);
    await resetSession();
  }

  const distanceFromHome = useMemo(() => {
    if (!home || !coordinate) return null;
    return haversineDistanceM(home, coordinate);
  }, [home, coordinate]);

  const alerts = useMemo(() => getAlerts(telemetry, status), [telemetry, status]);

  const preflight = useMemo(
    () => evaluatePreflightHealth(telemetry, Date.now(), { sourceMode: activeSourceMode, home }),
    [telemetry, activeSourceMode, home]
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <Topbar
        ports={ports}
        status={status}
        loggingStatus={loggingStatus}
        runtimeMode={runtimeMode}
        wsConnected={wsConnected}
        packetCount={telemetry.packetCount}
        packetAge={packetAge(telemetry.lastPacketAt)}
        activeSourceMode={activeSourceMode}
        liveControlsLocked={liveControlsLocked}
        liveConnectedInBackground={liveConnectedInBackground}
        onSetSourceMode={setSourceMode}
        onRefreshPorts={refreshPorts}
        onConnect={(path, baudRate) => connect({ path, baudRate })}
        onDisconnect={disconnect}
        onReset={resetAll}
        onStartLogging={startLogging}
        onStopLogging={stopLogging}
      />

      {activeSourceMode !== "live" && <NonLiveBanner mode={activeSourceMode} />}

      <div className={`relative flex min-h-0 flex-1 ${dashboardTint(activeSourceMode)}`}>
        <TelemetrySidebar telemetry={telemetry} distanceFromHome={distanceFromHome} alerts={alerts} preflight={preflight} />
        <ErrorBoundary>
          <MapPanel
            telemetry={telemetry}
            coordinate={coordinate}
            home={home}
            trackMode={isControlledTrack ? "controlled" : "internal"}
            controlledTrack={replay.replayTrack}
          />
        </ErrorBoundary>
        <ActivityLogPanel logs={logs} messages={status.mavlinkMessages ?? []} onClear={clearLogs} />
        <VideoPanel />

        {activeSourceMode !== "live" && (
          <div className="absolute right-4 top-4 z-20">
            <ReplaySimPanel mode={activeSourceMode} replay={replay} />
          </div>
        )}

        {error && (
          <div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-lg border border-red-400/30 bg-red-950/90 px-4 py-2 text-sm text-red-100 shadow-glow">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function dashboardTint(mode: "live" | "replay" | "simulation"): string {
  if (mode === "replay") return "ring-2 ring-inset ring-amber-400/30";
  if (mode === "simulation") return "ring-2 ring-inset ring-purple-400/30";
  return "";
}

function NonLiveBanner({ mode }: { mode: "replay" | "simulation" }) {
  const config =
    mode === "replay"
      ? {
          text: "REPLAY MODE — displaying recorded telemetry, not live vehicle data",
          className: "border-amber-400/40 bg-amber-400/10 text-amber-100"
        }
      : {
          text: "SIMULATION MODE — displaying synthetic telemetry, not live vehicle data",
          className: "border-purple-400/40 bg-purple-400/10 text-purple-100"
        };

  return (
    <div className={`shrink-0 border-b px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-[0.18em] ${config.className}`}>
      {config.text}
    </div>
  );
}

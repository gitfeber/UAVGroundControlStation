import { useEffect, useMemo, useState } from "react";
import { getAlerts } from "./lib/alerts";
import { haversineDistanceM, type Coordinate, validCoordinate } from "./lib/geo";
import { packetAge } from "./lib/format";
import { useTelemetry } from "./hooks/useTelemetry";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MapPanel } from "./components/MapPanel";
import { TelemetrySidebar } from "./components/TelemetrySidebar";
import { Topbar } from "./components/Topbar";
import { VideoPanel } from "./components/VideoPanel";
import { ActivityLogPanel } from "./components/ActivityLogPanel";

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
    clearLogs
  } = useTelemetry();

  const [home, setHome] = useState<Coordinate | null>(null);
  const coordinate = validCoordinate(telemetry.position?.lat, telemetry.position?.lon);

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
        onRefreshPorts={refreshPorts}
        onConnect={(path, baudRate) => connect({ path, baudRate })}
        onDisconnect={disconnect}
        onReset={resetAll}
        onStartLogging={startLogging}
        onStopLogging={stopLogging}
      />

      <div className="relative flex min-h-0 flex-1">
        <TelemetrySidebar telemetry={telemetry} distanceFromHome={distanceFromHome} alerts={alerts} />
        <ErrorBoundary>
          <MapPanel telemetry={telemetry} coordinate={coordinate} home={home} />
        </ErrorBoundary>
        <ActivityLogPanel logs={logs} messages={status.mavlinkMessages ?? []} onClear={clearLogs} />
        <VideoPanel />

        {error && (
          <div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-lg border border-red-400/30 bg-red-950/90 px-4 py-2 text-sm text-red-100 shadow-glow">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

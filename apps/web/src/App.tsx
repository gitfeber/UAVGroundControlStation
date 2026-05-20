import { useEffect, useMemo, useState } from "react";
import { getAlerts } from "./lib/alerts";
import { haversineDistanceM, type Coordinate, validCoordinate } from "./lib/geo";
import { packetAge } from "./lib/format";
import { useTelemetry } from "./hooks/useTelemetry";
import { MapPanel } from "./components/MapPanel";
import { TelemetrySidebar } from "./components/TelemetrySidebar";
import { Topbar } from "./components/Topbar";
import { VideoPanel } from "./components/VideoPanel";

export function App() {
  const {
    telemetry,
    status,
    loggingStatus,
    ports,
    error,
    wsConnected,
    refreshPorts,
    connect,
    disconnect,
    resetSession,
    startLogging,
    stopLogging
  } = useTelemetry();

  const [home, setHome] = useState<Coordinate | null>(null);
  const coordinate = validCoordinate(telemetry.position.lat, telemetry.position.lon);

  useEffect(() => {
    if (!home && coordinate) {
      setHome(coordinate);
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
        <MapPanel telemetry={telemetry} coordinate={coordinate} home={home} />
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

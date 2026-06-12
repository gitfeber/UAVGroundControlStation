import { useEffect, useMemo, useState } from "react";
import { getAlerts } from "./lib/alerts";
import { evaluatePreflightHealth } from "./lib/preflight";
import { haversineDistanceM, type Coordinate, validCoordinate } from "./lib/geo";
import { packetAge } from "./lib/format";
import { isTelemetryStale } from "./lib/telemetryStaleness";
import { useTelemetrySource } from "./hooks/useTelemetrySource";
import { useTargetEstimation } from "./hooks/useTargetEstimation";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MapPanel } from "./components/MapPanel";
import { TelemetrySidebar } from "./components/TelemetrySidebar";
import { Topbar } from "./components/Topbar";
import { VideoPanel } from "./components/VideoPanel";
import { ActivityLogPanel } from "./components/ActivityLogPanel";
import { ReplaySimPanel } from "./components/ReplaySimPanel";
import { SplashScreen } from "./components/SplashScreen";
import { OnboardingTour } from "./components/OnboardingTour";
import { getRemoteSerialControlApiBanner } from "./lib/apiSafety";
import { webSerialUnsupportedReason } from "./link/webSerialSupport";

const ENABLE_SPLASH_SCREEN = import.meta.env.VITE_ENABLE_SPLASH_SCREEN !== "false";

export function App() {
  const [showSplash, setShowSplash] = useState(ENABLE_SPLASH_SCREEN);
  const [dashboardReady, setDashboardReady] = useState(!ENABLE_SPLASH_SCREEN);
  const [tourRestartToken, setTourRestartToken] = useState(0);
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
  const targetEstimation = useTargetEstimation(telemetry, activeSourceMode);

  const [home, setHome] = useState<Coordinate | null>(null);
  const coordinate = validCoordinate(telemetry.position?.lat, telemetry.position?.lon);
  const isControlledTrack = activeSourceMode !== "live";
  const cloudUnsupported = useMemo(
    () => (runtimeMode === "cloud" ? webSerialUnsupportedReason() : null),
    [runtimeMode]
  );
  const remoteSerialControlApiBanner = useMemo(() => {
    if (runtimeMode !== "web") {
      return null;
    }
    return getRemoteSerialControlApiBanner(
      import.meta.env.VITE_API_BASE_URL,
      import.meta.env.VITE_WS_URL,
      typeof window !== "undefined" ? window.location.origin : "http://localhost"
    );
  }, [runtimeMode]);

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

  // A 1 Hz wall-clock tick keyed into the preflight memo. Keep Date.now() out of
  // render (react-hooks/purity), and ensure freshness re-evaluates even when
  // telemetry stops arriving (a stale stream never changes the telemetry ref).
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const preflight = useMemo(
    () => evaluatePreflightHealth(telemetry, now, { sourceMode: activeSourceMode, home }),
    [telemetry, now, activeSourceMode, home]
  );

  const telemetryStale = useMemo(
    () => activeSourceMode === "live" && isTelemetryStale(telemetry.lastPacketAt, now),
    [activeSourceMode, telemetry.lastPacketAt, now]
  );

  return (
    <>
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
          onRestartTour={() => setTourRestartToken((token) => token + 1)}
        />

        {cloudUnsupported && <CloudUnsupportedBanner reason={cloudUnsupported} />}

        {remoteSerialControlApiBanner && <RemoteSerialControlApiBanner message={remoteSerialControlApiBanner} />}

        {activeSourceMode !== "live" && <NonLiveBanner mode={activeSourceMode} />}

        <div className={`relative flex min-h-0 flex-1 ${dashboardTint(activeSourceMode)}`}>
          <TelemetrySidebar
            telemetry={telemetry}
            distanceFromHome={distanceFromHome}
            alerts={alerts}
            preflight={preflight}
            targetEstimation={targetEstimation}
            telemetryStale={telemetryStale}
          />
          <ErrorBoundary>
            <MapPanel
              telemetry={telemetry}
              coordinate={coordinate}
              home={home}
              groundTarget={targetEstimation.estimate}
              telemetryStale={telemetryStale}
              trackMode={isControlledTrack ? "controlled" : "internal"}
              controlledTrack={replay.replayTrack}
            />
          </ErrorBoundary>
          <ActivityLogPanel logs={logs} messages={status.mavlinkMessages ?? []} onClear={clearLogs} />
          <VideoPanel estimate={targetEstimation.estimate} />

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
      {showSplash && (
        <SplashScreen
          onDone={() => {
            setShowSplash(false);
            setDashboardReady(true);
          }}
        />
      )}
      <OnboardingTour active={dashboardReady} runtimeMode={runtimeMode} restartToken={tourRestartToken} />
    </>
  );
}

function CloudUnsupportedBanner({ reason }: { reason: string }) {
  return (
    <div className="shrink-0 border-b border-red-400/40 bg-red-500/10 px-4 py-2 text-center text-xs font-semibold text-red-100">
      Web Serial unavailable — {reason}
    </div>
  );
}

function RemoteSerialControlApiBanner({ message }: { message: string }) {
  return (
    <div className="shrink-0 border-b border-orange-400/50 bg-orange-500/15 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.12em] text-orange-100">
      {message}
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

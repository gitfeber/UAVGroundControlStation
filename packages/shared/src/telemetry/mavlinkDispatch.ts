import type { TelemetryStore } from "./telemetryStore.js";

/**
 * A decoded MAVLink frame, transport-agnostic: the Node server builds it from
 * `node-mavlink` packets, the browser cloud runtime builds it from the
 * hand-rolled Web Serial framer. `payload` is the message payload as a
 * `DataView`, zero-padded to the message's full (untruncated) length so the
 * store's fixed byte-offset reads are always in range.
 */
export interface MavlinkFrame {
  sysid: number;
  compid: number;
  msgid: number;
  payload: DataView;
}

/** MAVLink message IDs the {@link TelemetryStore} knows how to decode. */
export const messageIds = {
  heartbeat: 0,
  sysStatus: 1,
  gpsRawInt: 24,
  attitude: 30,
  globalPositionInt: 33,
  navControllerOutput: 62,
  rcChannels: 65,
  vfrHud: 74,
  radioStatus: 109,
  batteryStatus: 147,
  statusText: 253
} as const;

/**
 * Mark the packet and dispatch a decoded frame into the telemetry store. Does
 * not emit/notify — the caller decides how to surface the updated state
 * (the server emits an event; the browser link calls a subscriber).
 */
export function applyMavlinkFrame(store: TelemetryStore, frame: MavlinkFrame): void {
  store.markPacket(frame.sysid, frame.compid);

  const payload = frame.payload;
  switch (frame.msgid) {
    case messageIds.heartbeat:
      store.updateHeartbeat(payload);
      break;
    case messageIds.sysStatus:
      store.updateSysStatus(payload);
      break;
    case messageIds.batteryStatus:
      store.updateBatteryStatus(payload);
      break;
    case messageIds.gpsRawInt:
      store.updateGpsRawInt(payload);
      break;
    case messageIds.globalPositionInt:
      store.updateGlobalPositionInt(payload);
      break;
    case messageIds.vfrHud:
      store.updateVfrHud(payload);
      break;
    case messageIds.attitude:
      store.updateAttitude(payload);
      break;
    case messageIds.radioStatus:
      store.updateRadioStatus(payload);
      break;
    case messageIds.rcChannels:
      store.updateRcChannels(payload);
      break;
    case messageIds.statusText:
      store.updateStatusText(payload);
      break;
    case messageIds.navControllerOutput:
      store.updateNavControllerOutput(payload);
      break;
    default:
      break;
  }
}

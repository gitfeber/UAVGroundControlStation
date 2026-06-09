/**
 * Per-message MAVLink constants for the browser framer, for the subset of
 * message IDs the {@link TelemetryStore} consumes.
 *
 * These values are NOT hand-asserted. They are produced by
 * `__fixtures__/generate-mavlink-fixtures.py` straight from pymavlink's
 * authoritative `common` dialect (`crc_extra` and `unpacker.size`). The framer
 * test cross-checks these tables against the generated fixture tables, so a
 * wrong value here fails the suite rather than silently dropping a message.
 *
 * Keep in sync with `messageIds` in `@uav-ground-control-station/shared`.
 */

/** CRC seed byte mixed into the MAVLink X25 checksum, per message ID. */
export const CRC_EXTRA: Readonly<Record<number, number>> = {
  0: 50, // HEARTBEAT
  1: 124, // SYS_STATUS
  24: 24, // GPS_RAW_INT
  30: 39, // ATTITUDE
  33: 104, // GLOBAL_POSITION_INT
  62: 183, // NAV_CONTROLLER_OUTPUT
  65: 118, // RC_CHANNELS
  74: 20, // VFR_HUD
  109: 185, // RADIO_STATUS
  147: 154, // BATTERY_STATUS
  253: 83 // STATUSTEXT
};

/**
 * Full (untruncated) payload length per message ID. MAVLink v2 truncates
 * trailing zero payload bytes on the wire; the framer zero-pads back to this
 * length so the store's fixed byte-offset reads are always in range.
 */
export const MAX_PAYLOAD_LEN: Readonly<Record<number, number>> = {
  0: 9, // HEARTBEAT
  1: 31, // SYS_STATUS
  24: 52, // GPS_RAW_INT
  30: 28, // ATTITUDE
  33: 28, // GLOBAL_POSITION_INT
  62: 26, // NAV_CONTROLLER_OUTPUT
  65: 42, // RC_CHANNELS
  74: 20, // VFR_HUD
  109: 9, // RADIO_STATUS
  147: 54, // BATTERY_STATUS
  253: 54 // STATUSTEXT
};

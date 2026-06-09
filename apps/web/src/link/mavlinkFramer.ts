import type { MavlinkFrame } from "@uav-ground-control-station/shared";
import { CRC_EXTRA, MAX_PAYLOAD_LEN } from "./mavlinkTables";

/**
 * Streaming MAVLink v1/v2 framer for the browser cloud runtime.
 *
 * Web Serial hands us raw `Uint8Array` chunks with no frame boundaries. This
 * resync-capable state machine accumulates bytes, finds frame starts, validates
 * the MAVLink X25 CRC (with the per-message CRC_EXTRA), and emits decoded
 * {@link MavlinkFrame}s with the payload zero-padded to the message's full
 * length so the shared `TelemetryStore` can read it by fixed byte offsets.
 *
 * Decode of the payload itself is NOT done here — that is the store's job. The
 * framer only does transport framing. See ADR 0006.
 */

const V1_STX = 0xfe;
const V2_STX = 0xfd;
const V1_HEADER_LEN = 6; // stx, len, seq, sysid, compid, msgid
const V2_HEADER_LEN = 10; // stx, len, incompat, compat, seq, sysid, compid, msgid[3]
const CHECKSUM_LEN = 2;
const V2_INCOMPAT_SIGNED = 0x01;
const V2_SIGNATURE_LEN = 13;

const EMPTY = new Uint8Array(0);

export class MavlinkFramer {
  private buffer: Uint8Array = EMPTY;
  private crcErrorCount = 0;

  /** Count of frames dropped for a failed CRC (used for the link's parserErrors). */
  get crcErrors(): number {
    return this.crcErrorCount;
  }

  reset(): void {
    this.buffer = EMPTY;
    this.crcErrorCount = 0;
  }

  /** Feed a chunk of serial bytes; returns every complete, CRC-valid frame found. */
  push(chunk: Uint8Array): MavlinkFrame[] {
    const buf = this.concat(this.buffer, chunk);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const total = buf.byteLength;
    const frames: MavlinkFrame[] = [];

    let pos = 0;
    while (pos < total) {
      const stx = view.getUint8(pos);
      const isV2 = stx === V2_STX;
      if (stx !== V1_STX && !isV2) {
        pos += 1; // not a frame start — scan forward
        continue;
      }

      const headerLen = isV2 ? V2_HEADER_LEN : V1_HEADER_LEN;
      if (pos + headerLen > total) {
        break; // header not fully arrived yet — keep from here
      }

      const payloadLen = view.getUint8(pos + 1);
      let frameLen = headerLen + payloadLen + CHECKSUM_LEN;
      if (isV2 && (view.getUint8(pos + 2) & V2_INCOMPAT_SIGNED) !== 0) {
        frameLen += V2_SIGNATURE_LEN;
      }
      if (pos + frameLen > total) {
        break; // full frame not arrived yet — keep from here
      }

      const msgid = isV2
        ? view.getUint8(pos + 7) | (view.getUint8(pos + 8) << 8) | (view.getUint8(pos + 9) << 16)
        : view.getUint8(pos + 5);
      const payloadStart = pos + headerLen;
      const checksumPos = payloadStart + payloadLen;

      const crcExtra = CRC_EXTRA[msgid];
      if (crcExtra === undefined) {
        // Message we don't decode and can't CRC-validate (no CRC_EXTRA). Trust
        // the length and skip the whole frame. A bad length only desyncs until
        // the next message we DO know, whose CRC check resyncs us byte-by-byte.
        pos += frameLen;
        continue;
      }

      const expectedCrc = view.getUint8(checksumPos) | (view.getUint8(checksumPos + 1) << 8);
      const actualCrc = crc16Mcrf4xx(view, pos + 1, checksumPos, crcExtra);
      if (actualCrc !== expectedCrc) {
        this.crcErrorCount += 1;
        pos += 1; // false start or corruption — resync from the next byte
        continue;
      }

      frames.push({
        sysid: isV2 ? view.getUint8(pos + 5) : view.getUint8(pos + 3),
        compid: isV2 ? view.getUint8(pos + 6) : view.getUint8(pos + 4),
        msgid,
        payload: padPayload(buf, payloadStart, payloadLen, MAX_PAYLOAD_LEN[msgid] ?? payloadLen)
      });
      pos += frameLen;
    }

    // Retain only the unconsumed tail so a frame split across chunks reassembles.
    this.buffer = pos >= total ? EMPTY : buf.subarray(pos);
    return frames;
  }

  private concat(head: Uint8Array, tail: Uint8Array): Uint8Array {
    if (head.byteLength === 0) {
      // `subarray` shares the chunk's buffer; copy so later reads are stable.
      return tail.slice();
    }
    const merged = new Uint8Array(head.byteLength + tail.byteLength);
    merged.set(head, 0);
    merged.set(tail, head.byteLength);
    return merged;
  }
}

/**
 * Copy the on-wire payload into a buffer of the message's full length,
 * zero-padding any bytes MAVLink v2 truncation dropped.
 */
function padPayload(buf: Uint8Array, start: number, wireLen: number, fullLen: number): DataView {
  const out = new Uint8Array(fullLen);
  const copyLen = Math.min(wireLen, fullLen);
  out.set(buf.subarray(start, start + copyLen), 0);
  return new DataView(out.buffer);
}

/**
 * MAVLink X25 checksum (CRC-16/MCRF4XX): accumulate every byte from after the
 * start byte through the end of the payload, then mix in the message CRC_EXTRA.
 */
function crc16Mcrf4xx(view: DataView, start: number, end: number, crcExtra: number): number {
  let crc = 0xffff;
  for (let i = start; i < end; i += 1) {
    crc = crcAccumulate(view.getUint8(i), crc);
  }
  return crcAccumulate(crcExtra, crc);
}

function crcAccumulate(byte: number, crc: number): number {
  let tmp = byte ^ (crc & 0xff);
  tmp = (tmp ^ (tmp << 4)) & 0xff;
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
}

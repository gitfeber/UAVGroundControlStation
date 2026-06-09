/**
 * Streaming CRSF framer for the browser cloud runtime (TX16S telem mirror).
 * Mirrors the desktop Rust parser in `apps/desktop/src-tauri/src/crsf.rs`.
 */

const CRSF_SYNC_BYTES = [0xc8, 0xea, 0xec, 0xee, 0xef] as const;
const CRSF_MAX_FRAME_LEN = 64;

export interface CrsfFrame {
  frameType: number;
  payload: Uint8Array;
}

const EMPTY = new Uint8Array(0);

export class CrsfFramer {
  private buffer: Uint8Array = EMPTY;

  reset(): void {
    this.buffer = EMPTY;
  }

  push(chunk: Uint8Array): CrsfFrame[] {
    const buf = concat(this.buffer, chunk);
    const frames: CrsfFrame[] = [];
    let pos = 0;

    while (pos < buf.byteLength) {
      const start = findSync(buf, pos);
      if (start === -1) {
        break;
      }
      if (start > pos) {
        pos = start;
      }

      if (pos + 2 > buf.byteLength) {
        break;
      }

      const frameLen = buf[pos + 1]!;
      if (frameLen < 2 || frameLen > CRSF_MAX_FRAME_LEN) {
        pos += 1;
        continue;
      }

      const totalLen = frameLen + 2;
      if (pos + totalLen > buf.byteLength) {
        break;
      }

      const frame = buf.subarray(pos, pos + totalLen);
      const parsed = parseFrame(frame);
      if (parsed) {
        frames.push(parsed);
      }
      pos += totalLen;
    }

    this.buffer = pos >= buf.byteLength ? EMPTY : buf.subarray(pos);
    return frames;
  }
}

function concat(head: Uint8Array, tail: Uint8Array): Uint8Array {
  if (head.byteLength === 0) {
    return tail.slice();
  }
  const merged = new Uint8Array(head.byteLength + tail.byteLength);
  merged.set(head, 0);
  merged.set(tail, head.byteLength);
  return merged;
}

function findSync(buf: Uint8Array, from: number): number {
  for (let i = from; i < buf.byteLength; i += 1) {
    if (CRSF_SYNC_BYTES.includes(buf[i]! as (typeof CRSF_SYNC_BYTES)[number])) {
      return i;
    }
  }
  return -1;
}

function parseFrame(frame: Uint8Array): CrsfFrame | null {
  if (frame.byteLength < 4) return null;

  const addr = frame[0]!;
  if (!CRSF_SYNC_BYTES.includes(addr as (typeof CRSF_SYNC_BYTES)[number])) {
    return null;
  }

  const len = frame[1]!;
  if (len < 2 || len > CRSF_MAX_FRAME_LEN || frame.byteLength !== len + 2) {
    return null;
  }

  const frameType = frame[2]!;
  const payload = frame.subarray(3, 1 + len);
  const receivedCrc = frame[1 + len]!;
  const crcInput = frame.subarray(2, 1 + len);
  if (crc8DvbS2(crcInput) !== receivedCrc) {
    return null;
  }

  return { frameType, payload: payload.slice() };
}

function crc8DvbS2(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.byteLength; i += 1) {
    crc ^= data[i]!;
    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x80) {
        crc = ((crc << 1) ^ 0xd5) & 0xff;
      } else {
        crc = (crc << 1) & 0xff;
      }
    }
  }
  return crc;
}

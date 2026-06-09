#!/usr/bin/env python3
"""Generate REAL MAVLink wire-byte fixtures for the browser framer tests.

These fixtures are NOT hand-built: every frame is encoded by pymavlink's
authoritative `common` dialect, and the per-message `crc_extra` / full payload
length are read straight from pymavlink. A wrong assumption in the framer's
CRC_EXTRA or length tables therefore makes the framer reject these real frames
(the test fails) instead of silently passing a self-referential check.

Usage (regenerate after changing the consumed message set):
    pip install --user pymavlink
    python3 generate-mavlink-fixtures.py > mavlink-fixtures.json

Output is committed as mavlink-fixtures.json so the test suite needs no Python.
"""

import io
import json
import sys

from pymavlink.dialects.v20 import common as v2
from pymavlink.dialects.v10 import common as v1

SRC_SYS = 1
SRC_COMP = 1

# Message IDs the TelemetryStore consumes (kept in sync with mavlinkDispatch).
CONSUMED = {
    "heartbeat": 0,
    "sys_status": 1,
    "gps_raw_int": 24,
    "attitude": 30,
    "global_position_int": 33,
    "nav_controller_output": 62,
    "rc_channels": 65,
    "vfr_hud": 74,
    "radio_status": 109,
    "battery_status": 147,
    "statustext": 253,
}

# Known core field values for the messages we assert through the store, so the
# test can check byte-offset decoding (lat/lon scaling, heading, etc.).
KNOWN = {
    "heartbeat": {"type": 2, "base_mode": 0x80 | 0x01, "custom_mode": 5},  # quad (MAV_TYPE 2), armed bit set, copter custom_mode 5 = LOITER
    "gps_raw_int": {"fix_type": 3, "lat": 473977418, "lon": 85451704,
                    "alt": 500000, "vel": 1234, "cog": 27000, "satellites_visible": 11},
    "global_position_int": {"lat": 473977418, "lon": 85451704, "alt": 500000,
                            "relative_alt": 120000, "hdg": 27000},
    "vfr_hud": {"airspeed": 12.5, "groundspeed": 11.0, "alt": 503.2,
                "climb": 1.5, "heading": 270},
    "attitude": {"roll": 0.1, "pitch": -0.05, "yaw": 1.57},
    # id/chunk_seq (v2 extensions) zeroed so the char[50] trailing zeros are the
    # frame's trailing bytes and v2 truncation actually fires for the pad test.
    "statustext": {"severity": 4, "text": "PreArm: check", "id": 0, "chunk_seq": 0},
}


def autofill(msgclass):
    """Build kwargs for every field so the constructor always succeeds, even
    for v2 extension fields. Core fields get overridden by KNOWN afterwards."""
    kwargs = {}
    # pymavlink quirk: `fieldtypes` is parallel to `fieldnames` (XML order) but
    # `array_lengths` is parallel to `ordered_fieldnames` (wire order). Key each
    # metadata dict to its own list so types and array lengths land on the right field.
    types = dict(zip(msgclass.fieldnames, msgclass.fieldtypes))
    arrlen = dict(zip(msgclass.ordered_fieldnames, msgclass.array_lengths))
    for idx, name in enumerate(msgclass.fieldnames):
        length = arrlen.get(name, 0)
        ftype = types.get(name, "")
        if ftype == "char":
            kwargs[name] = ("X" * length)[:length] if length else "X"
        elif length:
            kwargs[name] = [(idx + 1) % 100 for _ in range(length)]
        elif ftype in ("float", "double"):
            kwargs[name] = float(idx + 1)
        else:
            kwargs[name] = idx + 1
    return kwargs


def build(dialect, name):
    msgclass = getattr(dialect, "MAVLink_%s_message" % name)
    kwargs = autofill(msgclass)
    for k, val in KNOWN.get(name, {}).items():
        if k in kwargs:
            kwargs[k] = val
    # STATUSTEXT's __init__ does bytes ops on `text`; pass bytes, not str.
    if name == "statustext" and isinstance(kwargs.get("text"), str):
        kwargs["text"] = kwargs["text"].encode("ascii")
    return msgclass(**kwargs)


def pack(dialect, name):
    """Return the on-wire frame as hex. For v2 this is the truncated frame
    (trailing zero payload bytes dropped), exactly as a vehicle would send it."""
    mav = dialect.MAVLink(io.BytesIO(), srcSystem=SRC_SYS, srcComponent=SRC_COMP)
    mav.seq = 0
    msg = build(dialect, name)
    return msg.pack(mav).hex()


def main():
    out = {"note": "Real MAVLink frames from pymavlink common dialect. Regenerate with generate-mavlink-fixtures.py.",
           "pymavlink_dialect": "common", "messages": {}, "tables": {"crc_extra": {}, "max_payload_len": {}}}

    for name, msgid in CONSUMED.items():
        cls2 = getattr(v2, "MAVLink_%s_message" % name)
        full_len = cls2.unpacker.size  # authoritative full (untruncated) payload length
        entry = {
            "id": msgid,
            "crc_extra": cls2.crc_extra,
            "full_payload_len": full_len,
            "wire_v2_hex": pack(v2, name),
            "known": KNOWN.get(name, {}),
        }
        # v1 frame too (never truncated; no v2 extension fields).
        try:
            entry["wire_v1_hex"] = pack(v1, name)
        except AttributeError:
            entry["wire_v1_hex"] = None  # not present in the v1.0 dialect
        out["messages"][name] = entry
        out["tables"]["crc_extra"][str(msgid)] = cls2.crc_extra
        out["tables"]["max_payload_len"][str(msgid)] = full_len

    # A truncated v2 STATUSTEXT: short text leaves a long run of trailing zeros
    # in the char[50] field, so the wire payload is heavily truncated and the
    # framer must zero-pad it back to full length for the store to read it.
    out["truncated_statustext_v2_hex"] = pack(v2, "statustext")

    # A concatenated v2 byte stream of several messages, to test that the framer
    # emits all frames in order from one continuous buffer.
    stream_names = ["heartbeat", "attitude", "global_position_int", "vfr_hud", "gps_raw_int"]
    stream = b"".join(bytes.fromhex(pack(v2, n)) for n in stream_names)
    out["stream_v2"] = {"names": stream_names, "hex": stream.hex()}

    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

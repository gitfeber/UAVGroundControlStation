# MAVLink fixture: GIMBAL_DEVICE_ATTITUDE_STATUS (id 285)

Source: MAVLink `common.xml` message `GIMBAL_DEVICE_ATTITUDE_STATUS`.

## Payload layout (47 bytes, little-endian)

| Offset | Field | Type | Notes |
|--------|-------|------|-------|
| 0 | `time_boot_ms` | uint32 | Timestamp since boot |
| 4 | `q[0]` (w) | float32 | Quaternion w component |
| 8 | `q[1]` (x) | float32 | Quaternion x component |
| 12 | `q[2]` (y) | float32 | Quaternion y component |
| 16 | `q[3]` (z) | float32 | Quaternion z component |
| 20 | `angular_velocity_x` | float32 | rad/s |
| 24 | `angular_velocity_y` | float32 | rad/s |
| 28 | `angular_velocity_z` | float32 | rad/s |
| 32 | `failure_flags` | uint16 | Bitmap |
| 34 | `flags` | uint16 | `GIMBAL_DEVICE_FLAGS` |
| 36 | `target_system` | uint8 | |
| 37 | `target_component` | uint8 | |
| 38 | `delta_yaw` | float32 | rad |
| 42 | `delta_yaw_velocity` | float32 | rad/s |
| 46 | `gimbal_device_id` | uint8 | |

## Quaternion order

`q = [w, x, y, z]` — identity rotation is `[1, 0, 0, 0]`.

## Yaw frame flags (offset 34)

| Flag | Value | Meaning |
|------|-------|---------|
| `GIMBAL_DEVICE_FLAGS_YAW_LOCK` | 16 | Legacy earth frame when newer flags absent |
| `GIMBAL_DEVICE_FLAGS_YAW_IN_VEHICLE_FRAME` | 32 | Quaternion yaw relative to vehicle heading |
| `GIMBAL_DEVICE_FLAGS_YAW_IN_EARTH_FRAME` | 64 | Quaternion yaw relative to north |

Decoder priority: earth (64) → vehicle (32) → legacy lock (16) → vehicle fallback.

## Fixture: identity / earth frame

- `time_boot_ms = 500`
- `q = [1, 0, 0, 0]`
- `flags = 64` (`YAW_IN_EARTH_FRAME`)
- Expected euler: roll ≈ 0°, pitch ≈ 0°, yaw ≈ 0°
- Expected `yaw_in_earth_frame = true`

Rust constants: `apps/desktop/src-tauri/src/fixtures/gimbal_285.rs`

MAVLink v2 wrapper uses message id **285**, CRC extra **137**.

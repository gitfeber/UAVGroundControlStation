//! Documented MAVLink 285 fixtures — see docs/fixtures/gimbal-device-attitude-status-285.md

pub const GIMBAL_DEVICE_FLAGS_YAW_IN_EARTH_FRAME: u16 = 64;
pub const GIMBAL_DEVICE_FLAGS_YAW_IN_VEHICLE_FRAME: u16 = 32;

pub mod offsets {
    pub const Q_W: usize = 4;
    pub const Q_X: usize = 8;
    pub const Q_Y: usize = 12;
    pub const Q_Z: usize = 16;
    pub const FLAGS: usize = 34;
}

/// Identity quaternion, earth-frame yaw, `time_boot_ms = 500`.
#[cfg(test)]
pub const PAYLOAD_IDENTITY_EARTH_FRAME: [u8; 47] = [
    0xF4, 0x01, 0x00, 0x00, // time_boot_ms = 500
    0x00, 0x00, 0x80, 0x3F, // q[0] w = 1.0
    0x00, 0x00, 0x00, 0x00, // q[1] x = 0.0
    0x00, 0x00, 0x00, 0x00, // q[2] y = 0.0
    0x00, 0x00, 0x00, 0x00, // q[3] z = 0.0
    0x00, 0x00, 0x00, 0x00, // angular_velocity_x
    0x00, 0x00, 0x00, 0x00, // angular_velocity_y
    0x00, 0x00, 0x00, 0x00, // angular_velocity_z
    0x00, 0x00, // failure_flags
    0x40, 0x00, // flags = 64 (YAW_IN_EARTH_FRAME)
    0x00, // target_system
    0x00, // target_component
    0x00, 0x00, 0x00, 0x00, // delta_yaw
    0x00, 0x00, 0x00, 0x00, // delta_yaw_velocity
    0x00, // gimbal_device_id
];

/// Identity quaternion, vehicle-frame yaw flag.
#[cfg(test)]
pub const PAYLOAD_IDENTITY_VEHICLE_FRAME: [u8; 47] = {
    let mut payload = PAYLOAD_IDENTITY_EARTH_FRAME;
    payload[offsets::FLAGS] = 0x20;
    payload[offsets::FLAGS + 1] = 0x00;
    payload
};

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GimbalState {
    pub roll_deg: f64,
    pub pitch_deg: f64,
    pub yaw_deg: f64,
    pub source: String,
    pub sampled_at_ms: u64,
}

pub fn decode_gimbal_device_attitude_status(payload: &[u8], sampled_at_ms: u64) -> Option<GimbalState> {
    if payload.len() < 24 {
        return None;
    }

    let q = [
        read_f32(payload, 8)?,
        read_f32(payload, 12)?,
        read_f32(payload, 16)?,
        read_f32(payload, 20)?,
    ];
    let (roll_deg, pitch_deg, yaw_deg) = quaternion_to_euler_deg(q);

    Some(GimbalState {
        roll_deg,
        pitch_deg,
        yaw_deg,
        source: "mavlink285".to_string(),
        sampled_at_ms,
    })
}

/// Legacy/vendor stacks that emit compact roll/pitch/yaw radians on message id 265.
pub fn decode_gimbal_legacy_euler(payload: &[u8], sampled_at_ms: u64) -> Option<GimbalState> {
    if payload.len() < 12 {
        return None;
    }

    let roll_deg = radians_to_degrees(read_f32(payload, 0)? as f64);
    let pitch_deg = radians_to_degrees(read_f32(payload, 4)? as f64);
    let yaw_deg = normalize_heading(radians_to_degrees(read_f32(payload, 8)? as f64));

    Some(GimbalState {
        roll_deg,
        pitch_deg,
        yaw_deg,
        source: "mavlink265".to_string(),
        sampled_at_ms,
    })
}

pub fn apply_gimbal_sample(telemetry: &mut crate::TelemetryState, sample: GimbalState) {
    let replace = match telemetry.gimbal.as_ref().map(|g| g.source.as_str()) {
        _ if sample.source == "mavlink285" => true,
        Some("mavlink285") => false,
        Some("mavlink265") => sample.source == "mavlink265",
        None => sample.source == "mavlink265" || sample.source == "mavlink285",
        _ => false,
    };

    if replace {
        telemetry.sampled_at_ms = Some(sample.sampled_at_ms);
        telemetry.gimbal = Some(sample);
    }
}

fn quaternion_to_euler_deg(q: [f32; 4]) -> (f64, f64, f64) {
    let w = q[0] as f64;
    let x = q[1] as f64;
    let y = q[2] as f64;
    let z = q[3] as f64;

    let sin_roll = 2.0 * (w * x + y * z);
    let cos_roll = 1.0 - 2.0 * (x * x + y * y);
    let roll = sin_roll.atan2(cos_roll);

    let sin_pitch = 2.0 * (w * y - z * x);
    let pitch = if sin_pitch.abs() >= 1.0 {
        std::f64::consts::FRAC_PI_2.copysign(sin_pitch)
    } else {
        sin_pitch.asin()
    };

    let sin_yaw = 2.0 * (w * z + x * y);
    let cos_yaw = 1.0 - 2.0 * (y * y + z * z);
    let yaw = sin_yaw.atan2(cos_yaw);

    (
        radians_to_degrees(roll),
        radians_to_degrees(pitch),
        normalize_heading(radians_to_degrees(yaw)),
    )
}

fn read_f32(payload: &[u8], offset: usize) -> Option<f32> {
    let bytes = payload.get(offset..offset + 4)?;
    Some(f32::from_le_bytes(bytes.try_into().ok()?))
}

fn radians_to_degrees(value: f64) -> f64 {
    value * 180.0 / std::f64::consts::PI
}

fn normalize_heading(value: f64) -> f64 {
    ((value % 360.0) + 360.0) % 360.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_gimbal_device_quaternion_payload() {
        let mut payload = vec![0_u8; 40];
        payload[8..12].copy_from_slice(&1.0_f32.to_le_bytes());
        payload[12..16].copy_from_slice(&0.0_f32.to_le_bytes());
        payload[16..20].copy_from_slice(&0.0_f32.to_le_bytes());
        payload[20..24].copy_from_slice(&0.0_f32.to_le_bytes());

        let sample = decode_gimbal_device_attitude_status(&payload, 1234).expect("sample");
        assert_eq!(sample.source, "mavlink285");
        assert!(sample.roll_deg.abs() < 0.01);
        assert!(sample.pitch_deg.abs() < 0.01);
        assert!(sample.yaw_deg.abs() < 0.01);
    }

    #[test]
    fn decodes_legacy_euler_payload_for_message_265() {
        let mut payload = vec![0_u8; 12];
        payload[0..4].copy_from_slice(&0.1_f32.to_le_bytes());
        payload[4..8].copy_from_slice(&(-0.2_f32).to_le_bytes());
        payload[8..12].copy_from_slice(&1.5_f32.to_le_bytes());

        let sample = decode_gimbal_legacy_euler(&payload, 2000).expect("sample");
        assert_eq!(sample.source, "mavlink265");
        assert!((sample.roll_deg - 5.73).abs() < 0.1);
        assert!((sample.pitch_deg + 11.46).abs() < 0.2);
    }

    #[test]
    fn prefers_mavlink285_over_existing_265_sample() {
        let mut telemetry = crate::initial_telemetry();
        telemetry.gimbal = Some(GimbalState {
            roll_deg: 1.0,
            pitch_deg: 2.0,
            yaw_deg: 3.0,
            source: "mavlink265".to_string(),
            sampled_at_ms: 1000,
        });

        apply_gimbal_sample(
            &mut telemetry,
            GimbalState {
                roll_deg: 10.0,
                pitch_deg: -20.0,
                yaw_deg: 90.0,
                source: "mavlink285".to_string(),
                sampled_at_ms: 2000,
            },
        );

        let gimbal = telemetry.gimbal.expect("gimbal");
        assert_eq!(gimbal.source, "mavlink285");
        assert_eq!(telemetry.sampled_at_ms, Some(2000));
    }
}

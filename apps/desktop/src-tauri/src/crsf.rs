use crate::{mark_packet, update_stats, TelemetryState};

const CRSF_SYNC_BYTES: [u8; 5] = [0xC8, 0xEA, 0xEC, 0xEE, 0xEF];
const CRSF_MAX_FRAME_LEN: usize = 64;
pub const CRSF_STAT_BASE: u32 = 0x4000;

#[derive(Clone, Debug)]
pub struct CrsfFrame {
    pub frame_type: u8,
    pub payload: Vec<u8>,
}

pub struct CrsfFrameParser {
    buffer: Vec<u8>,
}

impl CrsfFrameParser {
    pub fn new() -> Self {
        Self {
            buffer: Vec::new(),
        }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Vec<CrsfFrame> {
        self.buffer.extend_from_slice(chunk);
        let mut frames = Vec::new();

        loop {
            let Some(start) = self.find_sync() else {
                if self.buffer.len() > 1 {
                    self.buffer.drain(0..1);
                    continue;
                }
                break;
            };

            if start > 0 {
                self.buffer.drain(0..start);
            }

            if self.buffer.len() < 2 {
                break;
            }

            let frame_len = self.buffer[1] as usize;
            if frame_len < 2 || frame_len > CRSF_MAX_FRAME_LEN {
                self.buffer.drain(0..1);
                continue;
            }

            let total_len = frame_len + 2;
            if self.buffer.len() < total_len {
                break;
            }

            let frame_bytes: Vec<u8> = self.buffer.drain(0..total_len).collect();
            if let Some(frame) = parse_frame(&frame_bytes) {
                frames.push(frame);
            }
        }

        frames
    }

    fn find_sync(&self) -> Option<usize> {
        self.buffer.iter().position(|byte| CRSF_SYNC_BYTES.contains(byte))
    }
}

fn parse_frame(frame: &[u8]) -> Option<CrsfFrame> {
    if frame.len() < 4 {
        return None;
    }

    let addr = frame[0];
    if !CRSF_SYNC_BYTES.contains(&addr) {
        return None;
    }

    let len = frame[1] as usize;
    if len < 2 || len > CRSF_MAX_FRAME_LEN || frame.len() != len + 2 {
        return None;
    }

    let frame_type = frame[2];
    let _payload_len = len.saturating_sub(2);
    let payload = frame.get(3..1 + len)?.to_vec();
    let received_crc = *frame.get(1 + len)?;
    let crc_input = frame.get(2..1 + len)?;

    if crc8_dvb_s2(crc_input) != received_crc {
        return None;
    }

    Some(CrsfFrame { frame_type, payload })
}

pub fn crsf_message_id(frame_type: u8) -> u32 {
    CRSF_STAT_BASE | frame_type as u32
}

pub fn crsf_message_label(frame_type: u8) -> String {
    match frame_type {
        0x02 => "CRSF GPS".to_string(),
        0x07 => "CRSF Vario".to_string(),
        0x08 => "CRSF Battery".to_string(),
        0x09 => "CRSF Baro Alt".to_string(),
        0x0B => "CRSF Heartbeat".to_string(),
        0x14 => "CRSF Link RX".to_string(),
        0x1D => "CRSF Link TX".to_string(),
        0x1E => "CRSF Attitude".to_string(),
        0x1F => "CRSF MAVLink FC".to_string(),
        0x21 => "CRSF Flight Mode".to_string(),
        0x3A => "CRSF Handset".to_string(),
        0x7F => "CRSF ArduPilot Telem (legacy)".to_string(),
        0x7A => "CRSF MSP Req".to_string(),
        0x80 => "CRSF ArduPilot Telem".to_string(),
        other => format!("CRSF 0x{other:02X}"),
    }
}

pub fn is_mavlink_passthrough(frame_type: u8) -> bool {
    // ArduPilot/ELRS use 0x7F/0x80 for FrSky passthrough telemetry, not raw MAVLink.
    let _ = frame_type;
    false
}

pub fn apply_crsf_frame(telemetry: &mut TelemetryState, frame: &CrsfFrame) {
    mark_crsf_packet(telemetry);
    if is_passthrough_host_frame(frame.frame_type) {
        apply_passthrough_payload(telemetry, &frame.payload);
    }

    match frame.frame_type {
        0x02 => update_gps(telemetry, &frame.payload),
        0x07 => update_vario(telemetry, &frame.payload),
        0x08 => update_battery(telemetry, &frame.payload),
        0x09 => update_baro_altitude(telemetry, &frame.payload),
        0x14 => update_link_rx(telemetry, &frame.payload),
        0x1E => update_attitude(telemetry, &frame.payload),
        0x1F => update_mavlink_fc(telemetry, &frame.payload),
        0x21 => update_flight_mode(telemetry, &frame.payload),
        _ => {}
    }

    update_stats(telemetry);
}

fn mark_crsf_packet(telemetry: &mut TelemetryState) {
    mark_packet(telemetry, 255, 191);
    telemetry.vehicle.r#type = "TX16S CRSF".to_string();
}

fn scaled_crsf_coordinate(raw: Option<i32>) -> Option<f64> {
    let value = raw?;
    if value == 0 || value == i32::MAX || value == i32::MIN {
        return None;
    }
    Some(value as f64 / 10_000_000.0)
}

fn update_gps(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 15 {
        return;
    }

    let lat = scaled_crsf_coordinate(read_i32_be(payload, 0));
    let lon = scaled_crsf_coordinate(read_i32_be(payload, 4));
    let speed_kmh = read_u16_be(payload, 8);
    let heading = read_u16_be(payload, 10);
    let alt_m = read_u16_be(payload, 12);
    let satellites = payload.get(14).copied();
    let sats = satellites.filter(|value| *value != 255);
    let has_position_fix = sats.map(|value| value >= 3).unwrap_or(false);

    if let Some(sats) = sats {
        telemetry.gps.satellites = Some(sats);
        telemetry.gps.fix_type = Some(if sats >= 6 {
            3
        } else if sats >= 3 {
            2
        } else if sats > 0 {
            1
        } else {
            0
        });
        telemetry.gps.fix_label = if sats >= 6 {
            "3D Fix".to_string()
        } else if sats >= 3 {
            "2D Fix".to_string()
        } else if sats > 0 {
            "No Fix".to_string()
        } else {
            "No GPS".to_string()
        };
    }

    // ArduPilot still emits CRSF GPS frames without a GNSS module; ignore lat/lon until sats >= 3.
    if !has_position_fix {
        return;
    }

    if let (Some(lat), Some(lon)) = (lat, lon) {
        telemetry.position.lat = Some(lat);
        telemetry.position.lon = Some(lon);
    } else {
        return;
    }

    if let Some(heading) = heading.filter(|value| *value != 65535) {
        let heading_deg = heading as f64 / 100.0;
        telemetry.position.heading_deg = Some(heading_deg);
        telemetry.position.ground_course_deg = Some(heading_deg);
        telemetry.motion.yaw_deg = Some(heading_deg);
    }
    if let Some(alt_m) = alt_m.filter(|value| *value != 65535) {
        let altitude = alt_m as f64 - 1000.0;
        telemetry.position.relative_alt = Some(altitude);
        telemetry.position.alt_msl = Some(altitude);
    }
    if let Some(speed_kmh) = speed_kmh.filter(|value| *value != 65535) {
        telemetry.motion.ground_speed = Some(speed_kmh as f64 / 10.0 / 3.6);
    }
}

fn update_vario(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 2 {
        return;
    }

    if let Some(cm_per_s) = read_i16_be(payload, 0) {
        telemetry.motion.climb_rate = Some(cm_per_s as f64 / 100.0);
    }
}

fn update_battery(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 8 {
        return;
    }

    let voltage_raw = read_u16_be(payload, 0);
    let current_raw = read_u16_be(payload, 2);
    let consumed = normalize_crsf_consumed_mah(read_u24_be(payload, 4));
    let remaining = normalize_crsf_battery_remaining(payload.get(7).copied());

    if let Some(voltage_raw) = voltage_raw.filter(|value| is_valid_crsf_battery_u16(*value)) {
        crate::set_voltage(telemetry, Some(voltage_raw as f64 / 10.0));
    }
    if let Some(current_raw) = current_raw.filter(|value| is_valid_crsf_battery_u16(*value)) {
        crate::set_current(telemetry, Some(current_raw as f64 / 10.0));
    }
    if let Some(consumed) = consumed {
        telemetry.battery.consumed_mah = Some(consumed);
    }
    if let Some(remaining) = remaining {
        telemetry.battery.remaining_percent = Some(remaining);
    }
}

const SUBTYPE_SINGLE_PASSTHROUGH: u8 = 0xF0;
const SUBTYPE_MULTI_PASSTHROUGH: u8 = 0xF2;
const APPID_BATT_1: u16 = 0x5003;
const APPID_BATT_2: u16 = 0x5008;

fn is_passthrough_host_frame(frame_type: u8) -> bool {
    frame_type == 0x7F || frame_type == 0x80 || frame_type == 0x3A
}

fn is_valid_crsf_battery_u16(value: u16) -> bool {
    value > 0 && value != 0x7FFF
}

fn normalize_crsf_battery_remaining(raw: Option<u8>) -> Option<i8> {
    let value = raw?;
    let signed = value as i8;
    if signed < 0 || signed > 100 {
        return None;
    }
    Some(signed)
}

fn normalize_crsf_consumed_mah(raw: Option<u32>) -> Option<i32> {
    let value = raw?;
    if value >= 0x7FFF {
        return None;
    }
    Some(value as i32)
}

pub fn apply_passthrough_payload(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.is_empty() {
        return;
    }

    apply_passthrough_at(telemetry, payload, 0);
}

fn apply_passthrough_at(telemetry: &mut TelemetryState, payload: &[u8], offset: usize) {
    if offset >= payload.len() {
        return;
    }

    let sub_type = payload[offset];
    if sub_type == SUBTYPE_SINGLE_PASSTHROUGH && offset + 7 <= payload.len() {
        let appid = read_u16_le(payload, offset + 1).unwrap_or(0);
        let data = read_u32_le(payload, offset + 3).unwrap_or(0);
        apply_passthrough_packet(telemetry, appid, data);
        return;
    }

    if sub_type == SUBTYPE_MULTI_PASSTHROUGH && offset + 2 <= payload.len() {
        let count = payload[offset + 1] as usize;
        let mut pos = offset + 2;
        for _ in 0..count {
            if pos + 6 > payload.len() {
                break;
            }
            let appid = read_u16_le(payload, pos).unwrap_or(0);
            let data = read_u32_le(payload, pos + 2).unwrap_or(0);
            apply_passthrough_packet(telemetry, appid, data);
            pos += 6;
        }
    }
}

fn apply_passthrough_packet(telemetry: &mut TelemetryState, appid: u16, data: u32) {
    match appid {
        APPID_BATT_1 | APPID_BATT_2 => apply_passthrough_battery(telemetry, data),
        _ => {}
    }
}

fn apply_passthrough_battery(telemetry: &mut TelemetryState, data: u32) {
    let voltage_raw = data & 0x1FF;
    let current_raw = (data >> 9) & 0x7F;
    let consumed_mah = (data >> 17) & 0x7FFF;

    if voltage_raw > 0 {
        crate::set_voltage(telemetry, Some(voltage_raw as f64 / 10.0));
    }
    if current_raw > 0 {
        crate::set_current(telemetry, Some(current_raw as f64 / 10.0));
    }
    if consumed_mah > 0 && consumed_mah < 0x7FFF {
        telemetry.battery.consumed_mah = Some(consumed_mah as i32);
    }
}

fn update_baro_altitude(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 3 {
        return;
    }

    if let Some(altitude_dm) = read_i16_be(payload, 0) {
        telemetry.position.relative_alt = Some(altitude_dm as f64 / 10.0);
    }
}

fn update_link_rx(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 10 {
        return;
    }

    telemetry.radio.rssi = Some(payload[0]);
    telemetry.radio.rem_rssi = Some(payload[7]);
    telemetry.radio.link_quality = Some(payload[2]);
    telemetry.radio.fixed = Some(payload[4] as u16);
}

fn update_attitude(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 2 {
        return;
    }

    if let Some(pitch_deg) = attitude_axis_deg(payload, 0) {
        telemetry.motion.pitch_deg = Some(pitch_deg);
    }
    if payload.len() >= 4 {
        if let Some(roll_deg) = attitude_axis_deg(payload, 2) {
            telemetry.motion.roll_deg = Some(roll_deg);
        }
    }
    if payload.len() >= 6 {
        if let Some(yaw_deg) = attitude_axis_deg(payload, 4) {
            telemetry.motion.yaw_deg = Some(yaw_deg);
        }
    }
}

fn attitude_axis_deg(payload: &[u8], offset: usize) -> Option<f64> {
    // CRSF attitude uses radians * 10000 (TBS / ArduPilot CRSF telem).
    let raw_be = read_i16_be(payload, offset)?;
    if let Some(degrees) = radians10000_to_deg(raw_be) {
        return Some(degrees);
    }

    let raw_le = read_i16_le(payload, offset)?;
    radians10000_to_deg(raw_le)
}

fn radians10000_to_deg(raw: i16) -> Option<f64> {
    let radians = raw as f64 / 10_000.0;
    if !radians.is_finite() {
        return None;
    }

    let mut degrees = radians * 180.0 / std::f64::consts::PI;
    if !degrees.is_finite() {
        return None;
    }

    while degrees > 180.0 {
        degrees -= 360.0;
    }
    while degrees < -180.0 {
        degrees += 360.0;
    }

    Some(degrees)
}

fn update_mavlink_fc(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 9 {
        return;
    }

    let custom_mode = read_u32_be(payload, 3).unwrap_or(0);
    let firmware_type = payload.get(8).copied().unwrap_or(1);
    telemetry.vehicle.flight_mode = crate::flight_mode_label(firmware_type, custom_mode);
    telemetry.vehicle.r#type = crate::mav_type_label(firmware_type);
}

fn update_flight_mode(telemetry: &mut TelemetryState, payload: &[u8]) {
    let text = clean_ascii(payload);
    if is_plausible_flight_mode(&text) {
        telemetry.vehicle.flight_mode = text;
    }
}

fn is_plausible_flight_mode(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.len() < 3 || trimmed.len() > 16 {
        return false;
    }

    let mut letters = 0usize;
    for ch in trimmed.chars() {
        if ch.is_ascii_alphabetic() {
            letters += 1;
            continue;
        }
        if ch.is_ascii_digit() || matches!(ch, ' ' | '_' | '+' | '-') {
            continue;
        }
        return false;
    }

    letters >= 2
}

fn clean_ascii(payload: &[u8]) -> String {
    let bytes: Vec<u8> = payload
        .iter()
        .copied()
        .take_while(|byte| *byte != 0)
        .filter(|byte| (32..=126).contains(byte))
        .collect();

    String::from_utf8_lossy(&bytes).trim().to_string()
}

fn crc8_dvb_s2(data: &[u8]) -> u8 {
    let mut crc = 0_u8;
    for byte in data {
        crc ^= *byte;
        for _ in 0..8 {
            if crc & 0x80 != 0 {
                crc = ((crc << 1) ^ 0xD5) & 0xFF;
            } else {
                crc = (crc << 1) & 0xFF;
            }
        }
    }
    crc
}

fn read_i16_be(data: &[u8], offset: usize) -> Option<i16> {
    let bytes = data.get(offset..offset + 2)?;
    Some(i16::from_be_bytes([bytes[0], bytes[1]]))
}

fn read_i16_le(data: &[u8], offset: usize) -> Option<i16> {
    let bytes = data.get(offset..offset + 2)?;
    Some(i16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_u16_be(data: &[u8], offset: usize) -> Option<u16> {
    let bytes = data.get(offset..offset + 2)?;
    Some(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn read_i32_be(data: &[u8], offset: usize) -> Option<i32> {
    let bytes = data.get(offset..offset + 4)?;
    Some(i32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn read_u24_be(data: &[u8], offset: usize) -> Option<u32> {
    let bytes = data.get(offset..offset + 3)?;
    Some(((bytes[0] as u32) << 16) | ((bytes[1] as u32) << 8) | bytes[2] as u32)
}

fn read_u32_be(data: &[u8], offset: usize) -> Option<u32> {
    let bytes = data.get(offset..offset + 4)?;
    Some(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn read_u16_le(data: &[u8], offset: usize) -> Option<u16> {
    let bytes = data.get(offset..offset + 2)?;
    Some(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_u32_le(data: &[u8], offset: usize) -> Option<u32> {
    let bytes = data.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_frame(addr: u8, frame_type: u8, payload: &[u8]) -> Vec<u8> {
        let len_byte = (payload.len() + 2) as u8;
        let mut crc_input = vec![frame_type];
        crc_input.extend_from_slice(payload);
        let crc = crc8_dvb_s2(&crc_input);
        let mut frame = vec![addr, len_byte, frame_type];
        frame.extend_from_slice(payload);
        frame.push(crc);
        frame
    }

    #[test]
    fn parses_valid_crsf_heartbeat_frame() {
        let bytes = build_frame(0xC8, 0x0B, &[]);
        let mut parser = CrsfFrameParser::new();
        let frames = parser.push(&bytes);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].frame_type, 0x0B);
        assert!(frames[0].payload.is_empty());
    }

    #[test]
    fn rejects_crsf_frame_with_bad_crc() {
        let mut bytes = build_frame(0xEA, 0x08, &[0xFF; 8]);
        if let Some(last) = bytes.last_mut() {
            *last ^= 0x55;
        }
        let mut parser = CrsfFrameParser::new();
        assert!(parser.push(&bytes).is_empty());
    }

    #[test]
    fn crsf_message_label_maps_battery_type() {
        assert_eq!(crsf_message_label(0x08), "CRSF Battery");
    }
}

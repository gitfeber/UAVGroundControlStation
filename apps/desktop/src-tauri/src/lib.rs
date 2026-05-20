use chrono::Local;
use serde::{Deserialize, Serialize};
use serialport::{SerialPortType, UsbPortInfo};
use std::{
    fs::{create_dir_all, File},
    io::{BufWriter, Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSerialPortInfo {
    path: String,
    manufacturer: Option<String>,
    serial_number: Option<String>,
    vendor_id: Option<String>,
    product_id: Option<String>,
    pnp_id: Option<String>,
    location_id: Option<String>,
    friendly_name: Option<String>,
    transport: String,
    display_name: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectRequest {
    path: String,
    baud_rate: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStatus {
    serial_connected: bool,
    mavlink_packets: u64,
    last_packet_ms: Option<u64>,
    raw_bytes: u64,
    parser_errors: u64,
    last_serial_error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoggingStatus {
    active: bool,
    file_path: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TelemetryState {
    connected: bool,
    last_packet_at: Option<u64>,
    packet_count: u64,
    vehicle: VehicleState,
    position: PositionState,
    gps: GpsState,
    motion: MotionState,
    battery: BatteryState,
    radio: RadioState,
    system: SystemState,
    stats: StatsState,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VehicleState {
    system_id: Option<u8>,
    component_id: Option<u8>,
    r#type: String,
    armed: bool,
    flight_mode: String,
    base_mode: Option<u8>,
    custom_mode: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PositionState {
    lat: Option<f64>,
    lon: Option<f64>,
    alt_msl: Option<f64>,
    relative_alt: Option<f64>,
    heading_deg: Option<f64>,
    ground_course_deg: Option<f64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GpsState {
    fix_type: Option<u8>,
    fix_label: String,
    satellites: Option<u8>,
    eph: Option<f64>,
    epv: Option<f64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MotionState {
    ground_speed: Option<f64>,
    air_speed: Option<f64>,
    climb_rate: Option<f64>,
    roll_deg: Option<f64>,
    pitch_deg: Option<f64>,
    yaw_deg: Option<f64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatteryState {
    voltage: Option<f64>,
    current: Option<f64>,
    remaining_percent: Option<i8>,
    consumed_mah: Option<i32>,
    cell_voltage_estimate: Option<f64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RadioState {
    rssi: Option<u8>,
    rem_rssi: Option<u8>,
    rx_errors: Option<u16>,
    fixed: Option<u16>,
    tx_buffer: Option<u8>,
    link_quality: Option<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemState {
    load_percent: Option<f64>,
    sensors_present: Option<u32>,
    sensors_enabled: Option<u32>,
    sensors_health: Option<u32>,
    status_text: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatsState {
    min_voltage: Option<f64>,
    max_altitude: Option<f64>,
    max_speed: Option<f64>,
    max_distance: Option<f64>,
    max_current: Option<f64>,
    min_rssi: Option<u8>,
    warning_count: u32,
    session_started_at: u64,
}

#[derive(Clone)]
struct MavlinkFrame {
    message_id: u32,
    system_id: u8,
    component_id: u8,
    payload: Vec<u8>,
}

struct MavlinkFrameParser {
    buffer: Vec<u8>,
    parser_errors: u64,
}

struct LoggerState {
    file_path: Option<PathBuf>,
    writer: Option<BufWriter<File>>,
}

#[derive(Clone, Default)]
struct SerialDiagnostics {
    raw_bytes: u64,
    parser_errors: u64,
    last_serial_error: Option<String>,
}

struct DesktopState {
    telemetry: Arc<Mutex<TelemetryState>>,
    stop_reader: Mutex<Option<Arc<AtomicBool>>>,
    logging: Arc<Mutex<LoggerState>>,
    diagnostics: Arc<Mutex<SerialDiagnostics>>,
}

const DEFAULT_BAUD_RATE: u32 = 460_800;
const STATUS_RING_LIMIT: usize = 20;

#[tauri::command]
fn list_ports() -> Result<Vec<DesktopSerialPortInfo>, String> {
    let mut ports: Vec<_> = serialport::available_ports()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter_map(|port| {
            let info = match &port.port_type {
                SerialPortType::UsbPort(usb) => Some(serial_info_from_usb(&port.port_name, usb)),
                SerialPortType::Unknown => serial_info_from_unknown(&port.port_name),
                SerialPortType::BluetoothPort => None,
                SerialPortType::PciPort => None,
            }?;

            Some(info)
        })
        .collect();

    ports.sort_by(|a, b| {
        transport_priority(&a.transport)
            .cmp(&transport_priority(&b.transport))
            .then_with(|| a.path.cmp(&b.path))
    });

    Ok(ports)
}

#[tauri::command]
fn connect(request: ConnectRequest, state: State<DesktopState>, app: AppHandle) -> Result<BackendStatus, String> {
    disconnect_inner(&state, &app)?;

    let path = request.path.trim().to_string();
    if path.is_empty() {
        return Err("Serial port path is required.".to_string());
    }

    let baud_rate = request.baud_rate.unwrap_or(DEFAULT_BAUD_RATE);
    let port = serialport::new(path, baud_rate)
        .timeout(Duration::from_millis(50))
        .open()
        .map_err(|error| error.to_string())?;
    let stop_flag = Arc::new(AtomicBool::new(false));
    let worker_stop_flag = Arc::clone(&stop_flag);
    let worker_state = state.inner().clone_for_worker();
    let worker_app = app.clone();

    {
        let mut telemetry = state.telemetry.lock().map_err(lock_error)?;
        telemetry.connected = true;
    }
    {
        let mut diagnostics = state.diagnostics.lock().map_err(lock_error)?;
        *diagnostics = SerialDiagnostics::default();
    }

    *state.stop_reader.lock().map_err(lock_error)? = Some(stop_flag);
    emit_status_and_telemetry(&app, &state)?;

    thread::spawn(move || {
        if let Err(error) = serial_reader_loop(port, worker_stop_flag, Arc::clone(&worker_state), worker_app.clone()) {
            eprintln!("Desktop serial reader stopped: {error}");
        }

        if let Ok(mut telemetry) = worker_state.telemetry.lock() {
            telemetry.connected = false;
            let telemetry = telemetry.clone();
            let _ = worker_app.emit("telemetry", &telemetry);
            if let Ok(diagnostics) = worker_state.diagnostics.lock() {
                let _ = worker_app.emit("status", status_from_parts(&telemetry, &diagnostics));
            }
        }
    });

    status_from_state(&state)
}

#[tauri::command]
fn disconnect(state: State<DesktopState>, app: AppHandle) -> Result<BackendStatus, String> {
    disconnect_inner(&state, &app)
}

fn disconnect_inner(state: &DesktopState, app: &AppHandle) -> Result<BackendStatus, String> {
    if let Some(flag) = state.stop_reader.lock().map_err(lock_error)?.take() {
        flag.store(true, Ordering::SeqCst);
    }

    {
        let mut telemetry = state.telemetry.lock().map_err(lock_error)?;
        telemetry.connected = false;
    }

    emit_status_and_telemetry(app, state)?;
    status_from_state(state)
}

#[tauri::command]
fn reset_session(state: State<DesktopState>, app: AppHandle) -> Result<TelemetryState, String> {
    let connected = state
        .telemetry
        .lock()
        .map_err(lock_error)?
        .connected;

    let telemetry = {
        let mut telemetry = state.telemetry.lock().map_err(lock_error)?;
        *telemetry = initial_telemetry();
        telemetry.connected = connected;
        telemetry.clone()
    };

    emit_status_and_telemetry(&app, &state)?;
    Ok(telemetry)
}

#[tauri::command]
fn get_status(state: State<DesktopState>) -> Result<BackendStatus, String> {
    status_from_state(&state)
}

#[tauri::command]
fn get_telemetry(state: State<DesktopState>) -> Result<TelemetryState, String> {
    state.telemetry.lock().map_err(lock_error).map(|telemetry| telemetry.clone())
}

#[tauri::command]
fn logging_status(state: State<DesktopState>) -> Result<LoggingStatus, String> {
    state.logging.lock().map_err(lock_error).map(|logging| LoggingStatus {
        active: logging.writer.is_some(),
        file_path: logging.file_path.as_ref().map(|path| path.display().to_string()),
    })
}

#[tauri::command]
fn start_logging(state: State<DesktopState>, app: AppHandle) -> Result<LoggingStatus, String> {
    let mut logging = state.logging.lock().map_err(lock_error)?;
    if logging.writer.is_some() {
        return Ok(logging_status_from_logger(&logging));
    }

    let logs_dir = app
        .path()
        .app_log_dir()
        .unwrap_or_else(|_| PathBuf::from("logs"));
    create_dir_all(&logs_dir).map_err(|error| error.to_string())?;

    let file_path = logs_dir.join(format!("flight-{}.jsonl", Local::now().format("%Y-%m-%d-%H-%M-%S")));
    let file = File::create(&file_path).map_err(|error| error.to_string())?;
    logging.file_path = Some(file_path);
    logging.writer = Some(BufWriter::new(file));

    Ok(logging_status_from_logger(&logging))
}

#[tauri::command]
fn stop_logging(state: State<DesktopState>) -> Result<LoggingStatus, String> {
    let mut logging = state.logging.lock().map_err(lock_error)?;
    if let Some(writer) = logging.writer.as_mut() {
        writer.flush().map_err(|error| error.to_string())?;
    }
    logging.writer = None;
    logging.file_path = None;

    Ok(logging_status_from_logger(&logging))
}

pub fn run() {
    tauri::Builder::default()
        .manage(DesktopState {
            telemetry: Arc::new(Mutex::new(initial_telemetry())),
            stop_reader: Mutex::new(None),
            logging: Arc::new(Mutex::new(LoggerState {
                file_path: None,
                writer: None,
            })),
            diagnostics: Arc::new(Mutex::new(SerialDiagnostics::default())),
        })
        .invoke_handler(tauri::generate_handler![
            list_ports,
            connect,
            disconnect,
            reset_session,
            get_status,
            get_telemetry,
            start_logging,
            stop_logging,
            logging_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running UAV Ground Control Station desktop app");
}

impl DesktopState {
    fn clone_for_worker(&self) -> Arc<WorkerState> {
        Arc::new(WorkerState {
            telemetry: Arc::clone(&self.telemetry),
            logging: Arc::clone(&self.logging),
            diagnostics: Arc::clone(&self.diagnostics),
        })
    }
}

struct WorkerState {
    telemetry: Arc<Mutex<TelemetryState>>,
    logging: Arc<Mutex<LoggerState>>,
    diagnostics: Arc<Mutex<SerialDiagnostics>>,
}

fn serial_reader_loop(
    mut port: Box<dyn serialport::SerialPort>,
    stop_flag: Arc<AtomicBool>,
    worker_state: Arc<WorkerState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut parser = MavlinkFrameParser::new();
    let mut read_buffer = [0_u8; 1024];

    while !stop_flag.load(Ordering::SeqCst) {
        match port.read(&mut read_buffer) {
            Ok(read) if read > 0 => {
                if let Ok(mut diagnostics) = worker_state.diagnostics.lock() {
                    diagnostics.raw_bytes += read as u64;
                }
                let frames = parser.push(&read_buffer[..read]);
                let parser_errors = parser.take_parser_errors();
                if parser_errors > 0 {
                    if let Ok(mut diagnostics) = worker_state.diagnostics.lock() {
                        diagnostics.parser_errors += parser_errors;
                    }
                }
                for frame in frames {
                    apply_frame(&worker_state, &app, frame)?;
                }
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(error) => {
                if let Ok(mut diagnostics) = worker_state.diagnostics.lock() {
                    diagnostics.last_serial_error = Some(error.to_string());
                }
                return Err(error.to_string());
            }
        }
    }

    Ok(())
}

fn apply_frame(worker_state: &WorkerState, app: &AppHandle, frame: MavlinkFrame) -> Result<(), String> {
    let telemetry = {
        let mut telemetry = worker_state.telemetry.lock().map_err(lock_error)?;
        mark_packet(&mut telemetry, frame.system_id, frame.component_id);

        match frame.message_id {
            0 => update_heartbeat(&mut telemetry, &frame.payload),
            1 => update_sys_status(&mut telemetry, &frame.payload),
            24 => update_gps_raw_int(&mut telemetry, &frame.payload),
            30 => update_attitude(&mut telemetry, &frame.payload),
            33 => update_global_position_int(&mut telemetry, &frame.payload),
            62 => update_nav_controller_output(&mut telemetry, &frame.payload),
            65 => update_rc_channels(&mut telemetry, &frame.payload),
            74 => update_vfr_hud(&mut telemetry, &frame.payload),
            109 => update_radio_status(&mut telemetry, &frame.payload),
            147 => update_battery_status(&mut telemetry, &frame.payload),
            253 => update_status_text(&mut telemetry, &frame.payload),
            _ => {}
        }

        telemetry.clone()
    };

    write_log_if_active(worker_state, &telemetry)?;
    let _ = app.emit("telemetry", &telemetry);
    if let Ok(diagnostics) = worker_state.diagnostics.lock() {
        let _ = app.emit("status", status_from_parts(&telemetry, &diagnostics));
    }

    Ok(())
}

impl MavlinkFrameParser {
    fn new() -> Self {
        Self {
            buffer: Vec::new(),
            parser_errors: 0,
        }
    }

    fn push(&mut self, chunk: &[u8]) -> Vec<MavlinkFrame> {
        self.buffer.extend_from_slice(chunk);
        let mut frames = Vec::new();

        loop {
            let Some(start) = self.find_start() else {
                if !self.buffer.is_empty() {
                    self.parser_errors += 1;
                }
                self.buffer.clear();
                break;
            };

            if start > 0 {
                self.parser_errors += 1;
                self.buffer.drain(0..start);
            }

            let Some(frame_len) = self.frame_len() else {
                break;
            };

            let frame: Vec<u8> = self.buffer.drain(0..frame_len).collect();
            if let Some(parsed) = parse_frame(&frame) {
                frames.push(parsed);
            } else {
                self.parser_errors += 1;
            }
        }

        frames
    }

    fn take_parser_errors(&mut self) -> u64 {
        let errors = self.parser_errors;
        self.parser_errors = 0;
        errors
    }

    fn find_start(&self) -> Option<usize> {
        self.buffer
            .iter()
            .position(|byte| *byte == 0xfe || *byte == 0xfd)
    }

    fn frame_len(&self) -> Option<usize> {
        if self.buffer.len() < 2 {
            return None;
        }

        let payload_len = self.buffer[1] as usize;
        match self.buffer[0] {
            0xfe => {
                let len = 6 + payload_len + 2;
                (self.buffer.len() >= len).then_some(len)
            }
            0xfd => {
                if self.buffer.len() < 3 {
                    return None;
                }

                let signature_len = if self.buffer[2] & 0x01 != 0 { 13 } else { 0 };
                let len = 10 + payload_len + 2 + signature_len;
                (self.buffer.len() >= len).then_some(len)
            }
            _ => None,
        }
    }
}

fn parse_frame(frame: &[u8]) -> Option<MavlinkFrame> {
    match frame.first().copied()? {
        0xfe => {
            let len = *frame.get(1)? as usize;
            Some(MavlinkFrame {
                message_id: *frame.get(5)? as u32,
                system_id: *frame.get(3)?,
                component_id: *frame.get(4)?,
                payload: frame.get(6..6 + len)?.to_vec(),
            })
        }
        0xfd => {
            let len = *frame.get(1)? as usize;
            let msg0 = *frame.get(7)? as u32;
            let msg1 = *frame.get(8)? as u32;
            let msg2 = *frame.get(9)? as u32;
            Some(MavlinkFrame {
                message_id: msg0 | (msg1 << 8) | (msg2 << 16),
                system_id: *frame.get(5)?,
                component_id: *frame.get(6)?,
                payload: frame.get(10..10 + len)?.to_vec(),
            })
        }
        _ => None,
    }
}

fn initial_telemetry() -> TelemetryState {
    TelemetryState {
        connected: false,
        last_packet_at: None,
        packet_count: 0,
        vehicle: VehicleState {
            system_id: None,
            component_id: None,
            r#type: "Unknown".to_string(),
            armed: false,
            flight_mode: "Unknown".to_string(),
            base_mode: None,
            custom_mode: None,
        },
        position: PositionState {
            lat: None,
            lon: None,
            alt_msl: None,
            relative_alt: None,
            heading_deg: None,
            ground_course_deg: None,
        },
        gps: GpsState {
            fix_type: None,
            fix_label: "No GPS".to_string(),
            satellites: None,
            eph: None,
            epv: None,
        },
        motion: MotionState {
            ground_speed: None,
            air_speed: None,
            climb_rate: None,
            roll_deg: None,
            pitch_deg: None,
            yaw_deg: None,
        },
        battery: BatteryState {
            voltage: None,
            current: None,
            remaining_percent: None,
            consumed_mah: None,
            cell_voltage_estimate: None,
        },
        radio: RadioState {
            rssi: None,
            rem_rssi: None,
            rx_errors: None,
            fixed: None,
            tx_buffer: None,
            link_quality: None,
        },
        system: SystemState {
            load_percent: None,
            sensors_present: None,
            sensors_enabled: None,
            sensors_health: None,
            status_text: vec![],
        },
        stats: StatsState {
            min_voltage: None,
            max_altitude: None,
            max_speed: None,
            max_distance: None,
            max_current: None,
            min_rssi: None,
            warning_count: 0,
            session_started_at: now_ms(),
        },
    }
}

fn mark_packet(telemetry: &mut TelemetryState, system_id: u8, component_id: u8) {
    telemetry.connected = true;
    telemetry.last_packet_at = Some(now_ms());
    telemetry.packet_count += 1;
    telemetry.vehicle.system_id = Some(system_id);
    telemetry.vehicle.component_id = Some(component_id);
}

fn update_heartbeat(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 9 {
        return;
    }

    let custom_mode = read_u32(payload, 0).unwrap_or(0);
    let vehicle_type = payload[4];
    let base_mode = payload[6];

    telemetry.vehicle.r#type = mav_type_label(vehicle_type);
    telemetry.vehicle.armed = base_mode & 0x80 != 0;
    telemetry.vehicle.base_mode = Some(base_mode);
    telemetry.vehicle.custom_mode = Some(custom_mode);
    telemetry.vehicle.flight_mode = flight_mode_label(vehicle_type, custom_mode);
}

fn update_sys_status(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 31 {
        return;
    }

    telemetry.system.sensors_present = read_u32(payload, 0);
    telemetry.system.sensors_enabled = read_u32(payload, 4);
    telemetry.system.sensors_health = read_u32(payload, 8);
    telemetry.system.load_percent = read_u16(payload, 12).map(|value| value as f64 / 10.0);

    let voltage = read_u16(payload, 14).and_then(|value| (value > 0).then_some(value as f64 / 1000.0));
    let current = read_i16(payload, 16).and_then(|value| (value != -1).then_some(value as f64 / 100.0));
    let remaining = read_i8(payload, 30).and_then(|value| (value >= 0).then_some(value));

    set_voltage(telemetry, voltage);
    set_current(telemetry, current);
    telemetry.battery.remaining_percent = remaining;
}

fn update_battery_status(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 36 {
        return;
    }

    let mut total_voltage = 0.0;
    let mut cells = 0;
    for offset in (5..25).step_by(2) {
        if let Some(mv) = read_u16(payload, offset) {
            if mv > 0 && mv != u16::MAX {
                total_voltage += mv as f64 / 1000.0;
                cells += 1;
            }
        }
    }

    let current = read_i16(payload, 25).and_then(|value| (value != -1).then_some(value as f64 / 100.0));
    let consumed = read_i32(payload, 27).and_then(|value| (value >= 0).then_some(value));
    let remaining = read_i8(payload, 35).and_then(|value| (value >= 0).then_some(value));

    set_voltage(telemetry, (cells > 0).then_some(total_voltage));
    set_current(telemetry, current);
    telemetry.battery.consumed_mah = consumed;
    telemetry.battery.remaining_percent = remaining;
}

fn update_gps_raw_int(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 30 {
        return;
    }

    let fix_type = payload[8];
    telemetry.gps.fix_type = Some(fix_type);
    telemetry.gps.fix_label = gps_fix_label(fix_type);
    telemetry.gps.eph = read_u16(payload, 21).and_then(|value| (value != u16::MAX).then_some(value as f64 / 100.0));
    telemetry.gps.epv = read_u16(payload, 23).and_then(|value| (value != u16::MAX).then_some(value as f64 / 100.0));
    telemetry.gps.satellites = payload.get(29).copied().and_then(|value| (value != u8::MAX).then_some(value));

    if let (Some(lat), Some(lon)) = (
        read_i32(payload, 9).and_then(scaled_coordinate),
        read_i32(payload, 13).and_then(scaled_coordinate),
    ) {
        telemetry.position.lat = Some(lat);
        telemetry.position.lon = Some(lon);
    }

    telemetry.position.alt_msl = read_i32(payload, 17).map(|value| value as f64 / 1000.0);
    telemetry.motion.ground_speed = read_u16(payload, 25).and_then(|value| (value != u16::MAX).then_some(value as f64 / 100.0));
    telemetry.position.ground_course_deg = read_u16(payload, 27).and_then(|value| (value != u16::MAX).then_some(value as f64 / 100.0));
    update_stats(telemetry);
}

fn update_global_position_int(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 28 {
        return;
    }

    if let (Some(lat), Some(lon)) = (
        read_i32(payload, 4).and_then(scaled_coordinate),
        read_i32(payload, 8).and_then(scaled_coordinate),
    ) {
        telemetry.position.lat = Some(lat);
        telemetry.position.lon = Some(lon);
    }

    telemetry.position.alt_msl = read_i32(payload, 12).map(|value| value as f64 / 1000.0);
    telemetry.position.relative_alt = read_i32(payload, 16).map(|value| value as f64 / 1000.0);
    telemetry.position.heading_deg = read_u16(payload, 26).and_then(|value| (value != u16::MAX).then_some(value as f64 / 100.0));
    update_stats(telemetry);
}

fn update_vfr_hud(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 20 {
        return;
    }

    telemetry.motion.air_speed = read_f32(payload, 0).map(f64::from);
    telemetry.motion.ground_speed = read_f32(payload, 4).map(f64::from);
    telemetry.position.alt_msl = read_f32(payload, 8).map(f64::from);
    telemetry.motion.climb_rate = read_f32(payload, 12).map(f64::from);
    telemetry.position.heading_deg = read_i16(payload, 16).map(|value| normalize_heading(value as f64));
    update_stats(telemetry);
}

fn update_attitude(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 16 {
        return;
    }

    telemetry.motion.roll_deg = read_f32(payload, 4).map(|value| radians_to_degrees(value as f64));
    telemetry.motion.pitch_deg = read_f32(payload, 8).map(|value| radians_to_degrees(value as f64));
    telemetry.motion.yaw_deg = read_f32(payload, 12).map(|value| normalize_heading(radians_to_degrees(value as f64)));
}

fn update_radio_status(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 9 {
        return;
    }

    telemetry.radio.rssi = payload.first().copied();
    telemetry.radio.rem_rssi = payload.get(1).copied();
    telemetry.radio.tx_buffer = payload.get(2).copied();
    telemetry.radio.rx_errors = read_u16(payload, 5);
    telemetry.radio.fixed = read_u16(payload, 7);
    telemetry.radio.link_quality = telemetry.radio.rssi;
    update_stats(telemetry);
}

fn update_rc_channels(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 42 {
        return;
    }

    let rssi = payload[41];
    telemetry.radio.rssi = (rssi != u8::MAX).then_some(rssi);
    telemetry.radio.link_quality = telemetry.radio.rssi;
    update_stats(telemetry);
}

fn update_status_text(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 2 {
        return;
    }

    let severity = payload[0];
    let text = String::from_utf8_lossy(&payload[1..payload.len().min(51)])
        .trim_matches(char::from(0))
        .trim()
        .to_string();

    if text.is_empty() {
        return;
    }

    telemetry
        .system
        .status_text
        .insert(0, format!("{}: {}", severity_label(severity), text));
    telemetry.system.status_text.truncate(STATUS_RING_LIMIT);

    if severity <= 4 {
        telemetry.stats.warning_count += 1;
    }
}

fn update_nav_controller_output(telemetry: &mut TelemetryState, payload: &[u8]) {
    if payload.len() < 26 {
        return;
    }

    let wp_distance = read_u16(payload, 12).unwrap_or(0);
    let alt_error = read_f32(payload, 14).unwrap_or(0.0);
    let nav_bearing = read_i16(payload, 8).unwrap_or(0);
    let message = format!("NAV: wp {wp_distance}m, alt error {alt_error:.1}m, bearing {nav_bearing}deg");

    if telemetry.system.status_text.first() != Some(&message) {
        telemetry.system.status_text.insert(0, message);
        telemetry.system.status_text.truncate(STATUS_RING_LIMIT);
    }
}

fn set_voltage(telemetry: &mut TelemetryState, voltage: Option<f64>) {
    telemetry.battery.voltage = voltage;
    telemetry.battery.cell_voltage_estimate = voltage.map(|value| value / 4.0);
    telemetry.stats.min_voltage = min_optional(telemetry.stats.min_voltage, voltage);
}

fn set_current(telemetry: &mut TelemetryState, current: Option<f64>) {
    telemetry.battery.current = current;
    telemetry.stats.max_current = max_optional(telemetry.stats.max_current, current);
}

fn update_stats(telemetry: &mut TelemetryState) {
    telemetry.stats.max_altitude = max_optional(
        telemetry.stats.max_altitude,
        telemetry.position.relative_alt.or(telemetry.position.alt_msl),
    );
    telemetry.stats.max_speed = max_optional(telemetry.stats.max_speed, telemetry.motion.ground_speed);
    telemetry.stats.min_rssi = min_u8_optional(telemetry.stats.min_rssi, telemetry.radio.rssi);
}

fn serial_info_from_usb(path: &str, usb: &UsbPortInfo) -> DesktopSerialPortInfo {
    let display_name = usb
        .product
        .as_ref()
        .or(usb.manufacturer.as_ref())
        .map(|name| format!("{path} - {name}"))
        .unwrap_or_else(|| path.to_string());

    DesktopSerialPortInfo {
        path: path.to_string(),
        manufacturer: usb.manufacturer.clone(),
        serial_number: usb.serial_number.clone(),
        vendor_id: Some(format!("{:04X}", usb.vid)),
        product_id: Some(format!("{:04X}", usb.pid)),
        pnp_id: None,
        location_id: None,
        friendly_name: usb.product.clone(),
        transport: "usb".to_string(),
        display_name,
    }
}

fn serial_info_from_unknown(path: &str) -> Option<DesktopSerialPortInfo> {
    let is_windows_com = path.to_ascii_uppercase().starts_with("COM");
    let is_linux_usb = path.starts_with("/dev/ttyACM") || path.starts_with("/dev/ttyUSB");
    let is_macos_usb = path.starts_with("/dev/cu.usb") || path.starts_with("/dev/tty.usb");

    if !(is_windows_com || is_linux_usb || is_macos_usb) {
        return None;
    }

    Some(DesktopSerialPortInfo {
        path: path.to_string(),
        manufacturer: None,
        serial_number: None,
        vendor_id: None,
        product_id: None,
        pnp_id: None,
        location_id: None,
        friendly_name: None,
        transport: if is_windows_com { "windows-com" } else { "usb" }.to_string(),
        display_name: path.to_string(),
    })
}

fn status_from_state(state: &DesktopState) -> Result<BackendStatus, String> {
    let telemetry = state.telemetry.lock().map_err(lock_error)?;
    let diagnostics = state.diagnostics.lock().map_err(lock_error)?;
    Ok(status_from_parts(&telemetry, &diagnostics))
}

fn status_from_parts(telemetry: &TelemetryState, diagnostics: &SerialDiagnostics) -> BackendStatus {
    BackendStatus {
        serial_connected: telemetry.connected,
        mavlink_packets: telemetry.packet_count,
        last_packet_ms: telemetry.last_packet_at.map(|time| now_ms().saturating_sub(time)),
        raw_bytes: diagnostics.raw_bytes,
        parser_errors: diagnostics.parser_errors,
        last_serial_error: diagnostics.last_serial_error.clone(),
    }
}

fn emit_status_and_telemetry(app: &AppHandle, state: &DesktopState) -> Result<(), String> {
    let telemetry = state.telemetry.lock().map_err(lock_error)?.clone();
    let diagnostics = state.diagnostics.lock().map_err(lock_error)?.clone();
    let _ = app.emit("telemetry", &telemetry);
    let _ = app.emit("status", status_from_parts(&telemetry, &diagnostics));
    Ok(())
}

fn write_log_if_active(worker_state: &WorkerState, telemetry: &TelemetryState) -> Result<(), String> {
    let mut logging = worker_state.logging.lock().map_err(lock_error)?;
    if let Some(writer) = logging.writer.as_mut() {
        let entry = serde_json::json!({
            "time": now_ms(),
            "type": "telemetry",
            "data": telemetry
        });
        writeln!(writer, "{entry}").map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn logging_status_from_logger(logging: &LoggerState) -> LoggingStatus {
    LoggingStatus {
        active: logging.writer.is_some(),
        file_path: logging.file_path.as_ref().map(|path| path.display().to_string()),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn transport_priority(transport: &str) -> u8 {
    match transport {
        "usb" => 0,
        "windows-com" => 1,
        "serial" => 2,
        _ => 3,
    }
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "Desktop state lock failed.".to_string()
}

fn mav_type_label(vehicle_type: u8) -> String {
    match vehicle_type {
        0 => "Generic",
        1 => "Fixed Wing",
        2 => "Quadrotor",
        3 => "Coaxial",
        4 => "Helicopter",
        5 => "Antenna Tracker",
        6 => "GCS",
        10 => "Ground Rover",
        13 => "Hexarotor",
        14 => "Octorotor",
        15 => "Tricopter",
        19 => "VTOL QuadPlane",
        _ => return format!("MAV_TYPE_{vehicle_type}"),
    }
    .to_string()
}

fn flight_mode_label(vehicle_type: u8, custom_mode: u32) -> String {
    if vehicle_type == 1 || vehicle_type == 19 {
        return match custom_mode {
            0 => "MANUAL",
            2 => "STABILIZE",
            5 => "FBWA",
            6 => "FBWB",
            7 => "CRUISE",
            10 => "AUTO",
            11 => "RTL",
            12 => "LOITER",
            15 => "GUIDED",
            _ => return format!("PLANE_{custom_mode}"),
        }
        .to_string();
    }

    if [2, 3, 4, 13, 14, 15].contains(&vehicle_type) {
        return match custom_mode {
            0 => "STABILIZE",
            1 => "ACRO",
            2 => "ALT_HOLD",
            3 => "AUTO",
            4 => "GUIDED",
            5 => "LOITER",
            6 => "RTL",
            9 => "LAND",
            16 => "POSHOLD",
            17 => "BRAKE",
            _ => return format!("COPTER_{custom_mode}"),
        }
        .to_string();
    }

    format!("MODE_{custom_mode}")
}

fn gps_fix_label(fix_type: u8) -> String {
    match fix_type {
        0 => "No GPS",
        1 => "No Fix",
        2 => "2D Fix",
        3 => "3D Fix",
        4 => "DGPS",
        5 => "RTK Float",
        6 => "RTK Fixed",
        _ => return format!("Fix {fix_type}"),
    }
    .to_string()
}

fn severity_label(severity: u8) -> &'static str {
    match severity {
        0 => "EMERGENCY",
        1 => "ALERT",
        2 => "CRITICAL",
        3 => "ERROR",
        4 => "WARNING",
        5 => "NOTICE",
        6 => "INFO",
        7 => "DEBUG",
        _ => "STATUS",
    }
}

fn scaled_coordinate(raw: i32) -> Option<f64> {
    (raw != 0 && raw != i32::MAX).then_some(raw as f64 / 1e7)
}

fn radians_to_degrees(value: f64) -> f64 {
    value * 180.0 / std::f64::consts::PI
}

fn normalize_heading(value: f64) -> f64 {
    ((value % 360.0) + 360.0) % 360.0
}

fn max_optional(current: Option<f64>, next: Option<f64>) -> Option<f64> {
    match (current, next.filter(|value| value.is_finite())) {
        (Some(current), Some(next)) => Some(current.max(next)),
        (None, Some(next)) => Some(next),
        (current, _) => current,
    }
}

fn min_optional(current: Option<f64>, next: Option<f64>) -> Option<f64> {
    match (current, next.filter(|value| value.is_finite())) {
        (Some(current), Some(next)) => Some(current.min(next)),
        (None, Some(next)) => Some(next),
        (current, _) => current,
    }
}

fn min_u8_optional(current: Option<u8>, next: Option<u8>) -> Option<u8> {
    match (current, next) {
        (Some(current), Some(next)) => Some(current.min(next)),
        (None, Some(next)) => Some(next),
        (current, _) => current,
    }
}

fn read_u16(payload: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(payload.get(offset..offset + 2)?.try_into().ok()?))
}

fn read_i16(payload: &[u8], offset: usize) -> Option<i16> {
    Some(i16::from_le_bytes(payload.get(offset..offset + 2)?.try_into().ok()?))
}

fn read_i8(payload: &[u8], offset: usize) -> Option<i8> {
    payload.get(offset).copied().map(|value| value as i8)
}

fn read_u32(payload: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(payload.get(offset..offset + 4)?.try_into().ok()?))
}

fn read_i32(payload: &[u8], offset: usize) -> Option<i32> {
    Some(i32::from_le_bytes(payload.get(offset..offset + 4)?.try_into().ok()?))
}

fn read_f32(payload: &[u8], offset: usize) -> Option<f32> {
    Some(f32::from_le_bytes(payload.get(offset..offset + 4)?.try_into().ok()?))
}

use chrono::Local;
use serde::{Deserialize, Serialize};
use serialport::{DataBits, FlowControl, Parity, SerialPortType, StopBits, UsbPortInfo};
use std::{
    collections::HashMap,
    fs::{create_dir_all, File},
    io::{BufWriter, Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

mod crsf;

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
    tx_bytes: u64,
    parser_errors: u64,
    last_serial_error: Option<String>,
    mavlink_messages: Vec<MavlinkMessageStat>,
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
struct MavlinkMessageStat {
    id: u32,
    label: String,
    count: u64,
    last_seen_at: u64,
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
    tx_bytes: u64,
    parser_errors: u64,
    last_serial_error: Option<String>,
    message_counts: HashMap<u32, MavlinkMessageStat>,
}

struct DesktopState {
    telemetry: Arc<Mutex<TelemetryState>>,
    stop_reader: Mutex<Option<Arc<AtomicBool>>>,
    logging: Arc<Mutex<LoggerState>>,
    diagnostics: Arc<Mutex<SerialDiagnostics>>,
}

const DEFAULT_BAUD_RATE: u32 = 460_800;
const STATUS_RING_LIMIT: usize = 20;
/// Webview emit cadence: telemetry ~20Hz, status ~4Hz.
const TELEMETRY_EMIT_INTERVAL: Duration = Duration::from_millis(50);
const STATUS_EMIT_INTERVAL: Duration = Duration::from_millis(250);
/// CRSF-primary latch: number of CRC-valid CRSF frames required to latch, and
/// how long CRSF may be absent before the latch decays on a non-420k link.
const CRSF_LATCH_THRESHOLD: u32 = 3;
const CRSF_DECAY_INTERVAL: Duration = Duration::from_secs(3);

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
    let mut port = serialport::new(path, baud_rate)
        .data_bits(DataBits::Eight)
        .parity(Parity::None)
        .stop_bits(StopBits::One)
        .flow_control(FlowControl::None)
        .timeout(Duration::from_millis(250))
        .open()
        .map_err(|error| error.to_string())?;
    port.write_data_terminal_ready(true)
        .map_err(|error| format!("Failed to set DTR: {error}"))?;
    port.write_request_to_send(true)
        .map_err(|error| format!("Failed to set RTS: {error}"))?;
    thread::sleep(Duration::from_millis(500));
    let mut outbound_sequence = 0_u8;
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
    if baud_rate != 420_000 {
        let initial_wakeup_bytes = send_gcs_heartbeat(&mut *port, &mut outbound_sequence)
            .map_err(|error| format!("Failed to write MAVLink wake-up traffic: {error}"))?;
        {
            let mut diagnostics = state.diagnostics.lock().map_err(lock_error)?;
            diagnostics.tx_bytes += initial_wakeup_bytes as u64;
        }
    }

    *state.stop_reader.lock().map_err(lock_error)? = Some(stop_flag);
    emit_status_and_telemetry(&app, &state)?;

    thread::spawn(move || {
        if let Err(error) = serial_reader_loop(
            port,
            worker_stop_flag,
            Arc::clone(&worker_state),
            worker_app.clone(),
            outbound_sequence,
            baud_rate,
        ) {
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
    initial_sequence: u8,
    baud_rate: u32,
) -> Result<(), String> {
    let mut mavlink_parser = MavlinkFrameParser::new();
    let mut passthrough_mavlink_parser = MavlinkFrameParser::new();
    let mut crsf_parser = crsf::CrsfFrameParser::new();
    let listen_only = baud_rate == 420_000;
    // Debounced CRSF detection: a single CRC-valid CRSF frame is no longer
    // enough to disable MAVLink-direct parsing for the whole session. We latch
    // only after several frames and decay back if CRSF goes quiet.
    let mut crsf_primary = listen_only;
    let mut crsf_frame_count: u32 = 0;
    let mut last_crsf_frame = Instant::now();
    let mut read_buffer = [0_u8; 1024];
    // Coalesce webview emits: the parser updates shared state on every frame,
    // but we push telemetry to the UI at ~20Hz and status at ~4Hz instead of
    // once per frame (which floods the event channel on fast CRSF links).
    let mut last_status_emit = Instant::now() - STATUS_EMIT_INTERVAL;
    let mut last_telemetry_emit = Instant::now() - TELEMETRY_EMIT_INTERVAL;
    let mut last_gcs_heartbeat = Instant::now() - Duration::from_secs(2);
    let mut last_stream_request = Instant::now() - Duration::from_secs(2);
    let mut outbound_sequence = initial_sequence;

    while !stop_flag.load(Ordering::SeqCst) {
        let mut telemetry_dirty = false;

        if !listen_only && last_gcs_heartbeat.elapsed() >= Duration::from_secs(1) {
            let written = send_gcs_heartbeat(&mut *port, &mut outbound_sequence).map_err(|error| {
                record_serial_error(&worker_state, &error.to_string());
                error.to_string()
            })?;
            record_tx_bytes(&worker_state, written);
            last_gcs_heartbeat = Instant::now();
        }

        if !listen_only && should_request_streams(&worker_state, last_stream_request) {
            let written = request_ardupilot_streams(&mut *port, &mut outbound_sequence).map_err(|error| {
                record_serial_error(&worker_state, &error.to_string());
                error.to_string()
            })?;
            record_tx_bytes(&worker_state, written);
            last_stream_request = Instant::now();
        }

        // CRSF went quiet on a non-420k link: re-enable MAVLink-direct parsing.
        if crsf_primary && !listen_only && last_crsf_frame.elapsed() >= CRSF_DECAY_INTERVAL {
            crsf_primary = false;
            crsf_frame_count = 0;
        }

        match port.read(&mut read_buffer) {
            Ok(read) if read > 0 => {
                if let Ok(mut diagnostics) = worker_state.diagnostics.lock() {
                    diagnostics.raw_bytes += read as u64;
                }
                let chunk = &read_buffer[..read];
                let crsf_frames = crsf_parser.push(chunk);
                if !crsf_frames.is_empty() {
                    crsf_frame_count = crsf_frame_count.saturating_add(crsf_frames.len() as u32);
                    last_crsf_frame = Instant::now();
                    if !listen_only && crsf_frame_count >= CRSF_LATCH_THRESHOLD {
                        crsf_primary = true;
                    }
                    telemetry_dirty = true;
                }

                for frame in crsf_frames {
                    apply_crsf_frame(&worker_state, frame, &mut passthrough_mavlink_parser)?;
                }

                if !crsf_primary {
                    let mavlink_frames = mavlink_parser.push(chunk);
                    let mavlink_errors = mavlink_parser.take_parser_errors();
                    if mavlink_errors > 0 {
                        if let Ok(mut diagnostics) = worker_state.diagnostics.lock() {
                            diagnostics.parser_errors += mavlink_errors;
                        }
                    }
                    if !mavlink_frames.is_empty() {
                        telemetry_dirty = true;
                    }
                    for frame in mavlink_frames {
                        apply_frame(&worker_state, frame)?;
                    }
                }
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(error) => {
                record_serial_error(&worker_state, &error.to_string());
                emit_worker_status(&worker_state, &app)?;
                return Err(error.to_string());
            }
        }

        if telemetry_dirty && last_telemetry_emit.elapsed() >= TELEMETRY_EMIT_INTERVAL {
            emit_worker_telemetry(&worker_state, &app)?;
            last_telemetry_emit = Instant::now();
        }

        if last_status_emit.elapsed() >= STATUS_EMIT_INTERVAL {
            emit_worker_status(&worker_state, &app)?;
            last_status_emit = Instant::now();
        }
    }

    Ok(())
}

fn should_request_streams(worker_state: &WorkerState, last_stream_request: Instant) -> bool {
    let has_packets = worker_state
        .telemetry
        .lock()
        .map(|telemetry| telemetry.packet_count > 0)
        .unwrap_or(false);

    has_packets && last_stream_request.elapsed() >= Duration::from_secs(10)
}

fn send_gcs_heartbeat(port: &mut dyn serialport::SerialPort, sequence: &mut u8) -> std::io::Result<usize> {
    let mut payload = Vec::with_capacity(9);
    payload.extend_from_slice(&0_u32.to_le_bytes());
    payload.push(6); // MAV_TYPE_GCS
    payload.push(8); // MAV_AUTOPILOT_INVALID
    payload.push(0); // base_mode
    payload.push(0); // system_status
    payload.push(3); // mavlink_version

    let frame = mavlink_v1_packet(0, &payload, 50, sequence);
    port.write_all(&frame)?;
    port.flush()?;
    Ok(frame.len())
}

fn request_ardupilot_streams(port: &mut dyn serialport::SerialPort, sequence: &mut u8) -> std::io::Result<usize> {
    let mut total_written = 0;
    for stream_id in [0_u8, 1, 2, 3, 6, 10, 11, 12] {
        let mut payload = Vec::with_capacity(6);
        payload.extend_from_slice(&4_u16.to_le_bytes());
        payload.push(1); // target_system, common default for ArduPilot over USB
        payload.push(1); // target_component
        payload.push(stream_id);
        payload.push(1); // start_stop

        let frame = mavlink_v1_packet(66, &payload, 148, sequence);
        port.write_all(&frame)?;
        total_written += frame.len();
    }

    port.flush()?;
    Ok(total_written)
}

fn mavlink_v1_packet(message_id: u8, payload: &[u8], crc_extra: u8, sequence: &mut u8) -> Vec<u8> {
    let current_sequence = *sequence;
    *sequence = (*sequence).wrapping_add(1);

    let mut frame = Vec::with_capacity(8 + payload.len());
    frame.push(0xfe);
    frame.push(payload.len() as u8);
    frame.push(current_sequence);
    frame.push(255); // GCS system id
    frame.push(190); // GCS component id
    frame.push(message_id);
    frame.extend_from_slice(payload);

    let checksum = mavlink_x25_crc(&frame[1..], crc_extra);
    frame.extend_from_slice(&checksum.to_le_bytes());
    frame
}

fn mavlink_x25_crc(data: &[u8], crc_extra: u8) -> u16 {
    let mut crc = 0xffff_u16;
    for byte in data.iter().copied().chain(std::iter::once(crc_extra)) {
        let tmp = byte ^ (crc as u8);
        let tmp = tmp ^ (tmp << 4);
        crc = (crc >> 8) ^ ((tmp as u16) << 8) ^ ((tmp as u16) << 3) ^ ((tmp as u16) >> 4);
    }
    crc
}

fn record_serial_error(worker_state: &WorkerState, error: &str) {
    if let Ok(mut diagnostics) = worker_state.diagnostics.lock() {
        diagnostics.last_serial_error = Some(error.to_string());
    }
}

fn record_tx_bytes(worker_state: &WorkerState, written: usize) {
    if let Ok(mut diagnostics) = worker_state.diagnostics.lock() {
        diagnostics.tx_bytes += written as u64;
    }
}

fn record_message_stat(worker_state: &WorkerState, message_id: u32) {
    if let Ok(mut diagnostics) = worker_state.diagnostics.lock() {
        let label = if message_id >= crsf::CRSF_STAT_BASE {
            crsf::crsf_message_label((message_id - crsf::CRSF_STAT_BASE) as u8)
        } else {
            mavlink_message_label(message_id)
        };
        let entry = diagnostics
            .message_counts
            .entry(message_id)
            .or_insert_with(|| MavlinkMessageStat {
                id: message_id,
                label: label.clone(),
                count: 0,
                last_seen_at: now_ms(),
            });
        entry.label = label;
        entry.count += 1;
        entry.last_seen_at = now_ms();
    }
}

fn apply_crsf_frame(
    worker_state: &WorkerState,
    frame: crsf::CrsfFrame,
    passthrough_mavlink_parser: &mut MavlinkFrameParser,
) -> Result<(), String> {
    record_message_stat(worker_state, crsf::crsf_message_id(frame.frame_type));

    {
        let mut telemetry = worker_state.telemetry.lock().map_err(lock_error)?;
        crsf::apply_crsf_frame(&mut telemetry, &frame);
    }

    if !frame.payload.is_empty() && crsf::is_mavlink_passthrough(frame.frame_type) {
        for mavlink_frame in passthrough_mavlink_parser.push(&frame.payload) {
            apply_frame(worker_state, mavlink_frame)?;
        }
    }

    Ok(())
}

fn emit_worker_telemetry(worker_state: &WorkerState, app: &AppHandle) -> Result<(), String> {
    let telemetry = worker_state.telemetry.lock().map_err(lock_error)?.clone();
    write_log_if_active(worker_state, &telemetry)?;
    let _ = app.emit("telemetry", &telemetry);
    Ok(())
}

fn emit_worker_status(worker_state: &WorkerState, app: &AppHandle) -> Result<(), String> {
    let telemetry = worker_state.telemetry.lock().map_err(lock_error)?.clone();
    let diagnostics = worker_state.diagnostics.lock().map_err(lock_error)?.clone();
    let _ = app.emit("status", status_from_parts(&telemetry, &diagnostics));
    Ok(())
}

fn is_supported_mavlink_message(message_id: u32) -> bool {
    matches!(
        message_id,
        0 | 1 | 2 | 24 | 27 | 29 | 30 | 32 | 33 | 36 | 42 | 62 | 65 | 74 | 87 | 109 | 125 | 136 | 141 | 147 | 152
            | 163 | 165 | 168 | 178 | 193 | 241 | 245 | 253
    )
}

fn apply_frame(worker_state: &WorkerState, frame: MavlinkFrame) -> Result<(), String> {
    if !is_supported_mavlink_message(frame.message_id) {
        return Ok(());
    }

    record_message_stat(worker_state, frame.message_id);
    let mut telemetry = worker_state.telemetry.lock().map_err(lock_error)?;
    mark_packet(&mut telemetry, frame.system_id, frame.component_id);
    if telemetry.vehicle.r#type == "TX16S CRSF" {
        telemetry.vehicle.r#type = "ArduPilot".to_string();
    }

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
        self.drain_frames()
    }

    #[cfg(test)]
    fn push_isolated(&mut self, chunk: &[u8]) -> Vec<MavlinkFrame> {
        self.buffer.clear();
        self.parser_errors = 0;
        self.buffer.extend_from_slice(chunk);
        self.drain_frames()
    }

    fn drain_frames(&mut self) -> Vec<MavlinkFrame> {
        let mut frames = Vec::new();

        loop {
            let Some(start) = self.find_start() else {
                self.buffer.clear();
                break;
            };

            if start > 0 {
                self.buffer.drain(0..start);
            }

            let Some(frame_len) = self.frame_len() else {
                break;
            };

            match parse_frame(&self.buffer[0..frame_len]) {
                // Structurally valid frame we do not decode: skip it cleanly.
                Some(parsed) if !is_supported_mavlink_message(parsed.message_id) => {
                    self.buffer.drain(0..frame_len);
                }
                // Supported message with a verified x25 checksum: accept it.
                Some(parsed) if mavlink_crc_valid(&self.buffer[0..frame_len], parsed.message_id) => {
                    self.buffer.drain(0..frame_len);
                    frames.push(parsed);
                }
                // Bad CRC or garbage at this position. Drop a single byte and
                // resync instead of trusting a length that may come from a false
                // start byte embedded in another protocol's payload.
                _ => {
                    self.parser_errors += 1;
                    self.buffer.drain(0..1);
                }
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

/// Verify the trailing MAVLink x25 checksum of a complete v1/v2 frame.
///
/// The seed (`CRC_EXTRA`) is per message definition, so this only validates the
/// message IDs we decode (see `mavlink_crc_extra`). For a v2 frame the optional
/// 13-byte signature follows the checksum and is excluded from the calculation.
fn mavlink_crc_valid(frame: &[u8], message_id: u32) -> bool {
    let Some(crc_extra) = mavlink_crc_extra(message_id) else {
        return false;
    };

    let (header_len, payload_len) = match (frame.first().copied(), frame.get(1).copied()) {
        (Some(0xfe), Some(len)) => (6_usize, len as usize),
        (Some(0xfd), Some(len)) => (10_usize, len as usize),
        _ => return false,
    };

    let crc_start = header_len + payload_len;
    let Some(crc_bytes) = frame.get(crc_start..crc_start + 2) else {
        return false;
    };
    let Some(checksummed) = frame.get(1..crc_start) else {
        return false;
    };

    let expected = u16::from_le_bytes([crc_bytes[0], crc_bytes[1]]);
    mavlink_x25_crc(checksummed, crc_extra) == expected
}

/// CRC_EXTRA seed per supported message ID (common + ardupilotmega dialects).
/// Values mirror `is_supported_mavlink_message`; an ID absent here cannot be
/// CRC-validated and is therefore not accepted.
fn mavlink_crc_extra(message_id: u32) -> Option<u8> {
    let seed = match message_id {
        0 => 50,
        1 => 124,
        2 => 137,
        24 => 24,
        27 => 144,
        29 => 115,
        30 => 39,
        32 => 185,
        33 => 104,
        36 => 222,
        42 => 28,
        62 => 183,
        65 => 118,
        74 => 20,
        87 => 150,
        109 => 185,
        125 => 203,
        136 => 1,
        141 => 47,
        147 => 154,
        152 => 208,
        163 => 127,
        165 => 21,
        168 => 1,
        178 => 47,
        193 => 71,
        241 => 90,
        245 => 130,
        253 => 83,
        _ => return None,
    };
    Some(seed)
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

pub(crate) fn mark_packet(telemetry: &mut TelemetryState, system_id: u8, component_id: u8) {
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
    for offset in (10..30).step_by(2) {
        if let Some(mv) = read_u16(payload, offset) {
            if mv > 0 && mv != u16::MAX {
                total_voltage += mv as f64 / 1000.0;
                cells += 1;
            }
        }
    }

    let current = read_i16(payload, 30).and_then(|value| (value != -1).then_some(value as f64 / 100.0));
    let consumed = read_i32(payload, 0).and_then(|value| (value >= 0).then_some(value));
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

    let fix_type = payload[28];
    telemetry.gps.fix_type = Some(fix_type);
    telemetry.gps.fix_label = gps_fix_label(fix_type);
    telemetry.gps.eph = read_u16(payload, 20).and_then(|value| (value != u16::MAX).then_some(value as f64 / 100.0));
    telemetry.gps.epv = read_u16(payload, 22).and_then(|value| (value != u16::MAX).then_some(value as f64 / 100.0));
    telemetry.gps.satellites = payload.get(29).copied().and_then(|value| (value != u8::MAX).then_some(value));

    if let (Some(lat), Some(lon)) = (
        read_i32(payload, 8).and_then(scaled_coordinate),
        read_i32(payload, 12).and_then(scaled_coordinate),
    ) {
        telemetry.position.lat = Some(lat);
        telemetry.position.lon = Some(lon);
    }

    telemetry.position.alt_msl = read_i32(payload, 16).map(|value| value as f64 / 1000.0);
    telemetry.motion.ground_speed = read_u16(payload, 24).and_then(|value| (value != u16::MAX).then_some(value as f64 / 100.0));
    telemetry.position.ground_course_deg = read_u16(payload, 26).and_then(|value| (value != u16::MAX).then_some(value as f64 / 100.0));
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

    telemetry.radio.rx_errors = read_u16(payload, 0);
    telemetry.radio.fixed = read_u16(payload, 2);
    telemetry.radio.rssi = payload.get(4).copied();
    telemetry.radio.rem_rssi = payload.get(5).copied();
    telemetry.radio.tx_buffer = payload.get(6).copied();
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
    telemetry.battery.cell_voltage_estimate = voltage.and_then(estimate_cell_voltage);
    telemetry.stats.min_voltage = min_optional(telemetry.stats.min_voltage, voltage);
}

/// Per-cell voltage estimate. Infers the LiPo cell count from the pack voltage
/// (~3.8V nominal per cell) instead of assuming a fixed 4S pack, so 3S/6S packs
/// report a sensible per-cell figure.
fn estimate_cell_voltage(pack_voltage: f64) -> Option<f64> {
    if !pack_voltage.is_finite() || pack_voltage <= 0.0 {
        return None;
    }

    let cells = (pack_voltage / 3.8).round().clamp(1.0, 14.0);
    Some(pack_voltage / cells)
}

fn set_current(telemetry: &mut TelemetryState, current: Option<f64>) {
    telemetry.battery.current = current;
    telemetry.stats.max_current = max_optional(telemetry.stats.max_current, current);
}

pub(crate) fn update_stats(telemetry: &mut TelemetryState) {
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
        tx_bytes: diagnostics.tx_bytes,
        parser_errors: diagnostics.parser_errors,
        last_serial_error: diagnostics.last_serial_error.clone(),
        mavlink_messages: top_mavlink_messages(diagnostics),
    }
}

fn top_mavlink_messages(diagnostics: &SerialDiagnostics) -> Vec<MavlinkMessageStat> {
    let mut messages: Vec<_> = diagnostics.message_counts.values().cloned().collect();
    messages.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.id.cmp(&b.id)));
    messages.truncate(16);
    messages
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

pub(crate) fn mav_type_label(vehicle_type: u8) -> String {
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

pub(crate) fn flight_mode_label(vehicle_type: u8, custom_mode: u32) -> String {
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

fn mavlink_message_label(message_id: u32) -> String {
    match message_id {
        0 => "HEARTBEAT",
        1 => "SYS_STATUS",
        24 => "GPS_RAW_INT",
        30 => "ATTITUDE",
        33 => "GLOBAL_POSITION_INT",
        62 => "NAV_CONTROLLER_OUTPUT",
        65 => "RC_CHANNELS",
        74 => "VFR_HUD",
        109 => "RADIO_STATUS",
        147 => "BATTERY_STATUS",
        253 => "STATUSTEXT",
        2 => "SYSTEM_TIME",
        27 => "RAW_IMU",
        29 => "SCALED_PRESSURE",
        32 => "LOCAL_POSITION_NED",
        36 => "SERVO_OUTPUT_RAW",
        42 => "MISSION_CURRENT",
        87 => "POSITION_TARGET_GLOBAL_INT",
        125 => "POWER_STATUS",
        136 => "TERRAIN_REPORT",
        141 => "ALTITUDE",
        152 => "MEMINFO",
        163 => "AHRS",
        165 => "HWSTATUS",
        168 => "WIND",
        178 => "AHRS2",
        193 => "EKF_STATUS_REPORT",
        241 => "VIBRATION",
        245 => "EXTENDED_SYS_STATE",
        _ => return format!("MSG_{message_id}"),
    }
    .to_string()
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

#[cfg(test)]
mod parser_tests {
    use super::*;

    #[test]
    fn parses_mavlink_v1_heartbeat() {
        let mut sequence = 0_u8;
        let frame = mavlink_v1_packet(0, &[0; 9], 50, &mut sequence);
        let mut parser = MavlinkFrameParser::new();
        let frames = parser.push_isolated(&frame);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].message_id, 0);
        assert_eq!(frames[0].payload.len(), 9);
    }

    #[test]
    fn mavlink_parser_ignores_unsupported_message_id() {
        let mut sequence = 0_u8;
        let frame = mavlink_v1_packet(88, &[0; 9], 0, &mut sequence);
        let mut parser = MavlinkFrameParser::new();
        let frames = parser.push_isolated(&frame);
        assert!(frames.is_empty());
        assert_eq!(parser.take_parser_errors(), 0);
    }

    #[test]
    fn mavlink_parser_rejects_bad_crc() {
        let mut sequence = 0_u8;
        let mut frame = mavlink_v1_packet(0, &[0; 9], 50, &mut sequence);
        let last = frame.len() - 1;
        frame[last] ^= 0xff;
        let mut parser = MavlinkFrameParser::new();
        let frames = parser.push_isolated(&frame);
        assert!(frames.is_empty());
        assert!(parser.take_parser_errors() > 0);
    }
}

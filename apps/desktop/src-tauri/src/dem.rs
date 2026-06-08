//! Local DEM window cache and GeoTIFF elevation sampling for target estimation.

use geo_types::{Coord, Rect};
use geotiff::{GeoKeyDirectory, GeoTiff};
use serde::{Deserialize, Serialize};
use tiff::decoder::Decoder;
use tiff::tags::Tag;
use std::{
    fs::File,
    io::{BufReader, Read, Seek},
    path::PathBuf,
};

pub const DEFAULT_WINDOW_HALF_WIDTH_M: f64 = 2_000.0;
pub const RECENTER_MARGIN: f64 = 0.5;
pub const MAX_WINDOW_SAMPLES: usize = 512;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainMetadataResponse {
    pub vertical_datum: String,
    pub horizontal_crs: String,
    pub resolution_m: f64,
    pub loaded: bool,
    pub source_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainElevationSampleResponse {
    pub elevation_m: f64,
    pub nodata: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainRaySampleResponse {
    pub distance_m: f64,
    pub enu: [f64; 3],
    pub elevation_m: f64,
    pub nodata: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnuPoint {
    pub east_m: f64,
    pub north_m: f64,
    pub up_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainLookupResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elevation_m: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample: Option<TerrainRaySampleResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
}

type GeoTiffReader = GeoTiff;

pub struct DemService {
    geo_tiff: Option<GeoTiffReader>,
    metadata: TerrainMetadataResponse,
    window: Option<DemWindow>,
    horizontal_crs: Option<DemHorizontalCrs>,
    band_nodata: Option<f32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DemHorizontalCrs {
    Wgs84Geographic,
    /// ETRS89 / UTM zone 32N — EPSG:25832 projected DEM GeoTIFFs (e.g. 1 m DGM-class tiles).
    Epsg25832Utm32N,
}

struct DemWindow {
    crs: DemHorizontalCrs,
    center_lat: f64,
    center_lon: f64,
    west_lon: f64,
    north_lat: f64,
    cols: usize,
    rows: usize,
    lon_step: f64,
    lat_step: f64,
    west_easting: f64,
    north_northing: f64,
    east_step: f64,
    north_step: f64,
    nodata: Option<f32>,
    values: Vec<f32>,
}

#[derive(Debug)]
pub enum DemError {
    NotLoaded,
    OutOfCoverage,
    NoData,
    InvalidArgument(String),
    UnsupportedCrs(String),
    Io(String),
    GeoTiff(String),
}

impl std::fmt::Display for DemError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DemError::NotLoaded => write!(f, "terrain model not loaded"),
            DemError::OutOfCoverage => write!(f, "dem out of coverage"),
            DemError::NoData => write!(f, "dem nodata"),
            DemError::InvalidArgument(message) => write!(f, "{message}"),
            DemError::UnsupportedCrs(message) => write!(f, "{message}"),
            DemError::Io(message) => write!(f, "{message}"),
            DemError::GeoTiff(message) => write!(f, "{message}"),
        }
    }
}

impl DemService {
    pub fn new() -> Self {
        Self {
            geo_tiff: None,
            metadata: empty_metadata(),
            window: None,
            horizontal_crs: None,
            band_nodata: None,
        }
    }

    pub fn metadata(&self) -> TerrainMetadataResponse {
        self.metadata.clone()
    }

    pub fn load_terrain_model(&mut self, path: &str) -> Result<TerrainMetadataResponse, DemError> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err(DemError::InvalidArgument("terrain model path is empty".to_string()));
        }

        let source_path = PathBuf::from(trimmed);
        if !source_path.exists() {
            return Err(DemError::Io(format!("terrain model not found: {trimmed}")));
        }

        let band_nodata = read_gdal_nodata(&source_path)?;
        let file = File::open(&source_path).map_err(|error| DemError::Io(error.to_string()))?;
        let reader = BufReader::new(file);
        let geo_tiff = GeoTiff::read(reader).map_err(|error| DemError::GeoTiff(error.to_string()))?;

        let (crs, horizontal_crs) = detect_horizontal_crs(&geo_tiff)?;
        let extent = geo_tiff.model_extent();
        let resolution_m = estimate_resolution_m(&geo_tiff, &extent, crs);

        self.geo_tiff = Some(geo_tiff);
        self.window = None;
        self.horizontal_crs = Some(crs);
        self.band_nodata = band_nodata;
        self.metadata = TerrainMetadataResponse {
            vertical_datum: "geotiff-band-0".to_string(),
            horizontal_crs,
            resolution_m,
            loaded: true,
            source_path: Some(source_path.to_string_lossy().into_owned()),
        };

        Ok(self.metadata.clone())
    }

    pub fn clear_terrain_model(&mut self) {
        self.geo_tiff = None;
        self.window = None;
        self.horizontal_crs = None;
        self.band_nodata = None;
        self.metadata = empty_metadata();
    }

    pub fn terrain_amsl_at(&mut self, anchor_lat: f64, anchor_lon: f64, lat: f64, lon: f64) -> Result<f64, DemError> {
        let (east_m, north_m) = geodetic_to_enu(anchor_lat, anchor_lon, lat, lon);
        Ok(self.sample_enu(anchor_lat, anchor_lon, east_m, north_m)?.elevation_m)
    }

    pub fn get_elevation_at_enu(
        &mut self,
        anchor_lat: f64,
        anchor_lon: f64,
        east_m: f64,
        north_m: f64,
    ) -> Result<TerrainElevationSampleResponse, DemError> {
        let sample = self.sample_enu(anchor_lat, anchor_lon, east_m, north_m)?;
        Ok(TerrainElevationSampleResponse {
            elevation_m: sample.elevation_enu,
            nodata: false,
        })
    }

    pub fn terrain_amsl_lookup(
        &mut self,
        anchor_lat: f64,
        anchor_lon: f64,
        lat: f64,
        lon: f64,
    ) -> TerrainLookupResponse {
        match self.terrain_amsl_at(anchor_lat, anchor_lon, lat, lon) {
            Ok(value) => TerrainLookupResponse {
                elevation_m: Some(value),
                sample: None,
                failure: None,
            },
            Err(error) => TerrainLookupResponse {
                elevation_m: None,
                sample: None,
                failure: dem_failure_reason(&error),
            },
        }
    }

    pub fn elevation_at_enu_lookup(
        &mut self,
        anchor_lat: f64,
        anchor_lon: f64,
        east_m: f64,
        north_m: f64,
    ) -> TerrainLookupResponse {
        match self.get_elevation_at_enu(anchor_lat, anchor_lon, east_m, north_m) {
            Ok(sample) => TerrainLookupResponse {
                elevation_m: Some(sample.elevation_m),
                sample: None,
                failure: None,
            },
            Err(error) => TerrainLookupResponse {
                elevation_m: None,
                sample: None,
                failure: dem_failure_reason(&error),
            },
        }
    }

    pub fn get_elevations_along_ray(
        &mut self,
        anchor_lat: f64,
        anchor_lon: f64,
        origin: EnuPoint,
        direction: EnuPoint,
        distances_m: Vec<f64>,
    ) -> Result<Vec<TerrainLookupResponse>, DemError> {
        if !self.metadata.loaded {
            return Err(DemError::NotLoaded);
        }

        let dir_len = (direction.east_m.powi(2) + direction.north_m.powi(2) + direction.up_m.powi(2)).sqrt();
        if dir_len <= f64::EPSILON {
            return Err(DemError::InvalidArgument("direction vector is zero".to_string()));
        }

        let dir = EnuPoint {
            east_m: direction.east_m / dir_len,
            north_m: direction.north_m / dir_len,
            up_m: direction.up_m / dir_len,
        };

        let mut samples = Vec::with_capacity(distances_m.len());
        for distance_m in distances_m {
            let east_m = origin.east_m + dir.east_m * distance_m;
            let north_m = origin.north_m + dir.north_m * distance_m;
            let up_m = origin.up_m + dir.up_m * distance_m;
            match self.sample_enu(anchor_lat, anchor_lon, east_m, north_m) {
                Ok(sample) => samples.push(TerrainLookupResponse {
                    elevation_m: None,
                    sample: Some(TerrainRaySampleResponse {
                        distance_m,
                        enu: [east_m, north_m, up_m],
                        elevation_m: sample.elevation_enu,
                        nodata: false,
                    }),
                    failure: None,
                }),
                Err(error) => {
                    let failure = dem_failure_reason(&error)
                        .ok_or(error)?;
                    samples.push(TerrainLookupResponse {
                        elevation_m: None,
                        sample: None,
                        failure: Some(failure),
                    });
                }
            }
        }

        Ok(samples)
    }

    fn sample_enu(
        &mut self,
        anchor_lat: f64,
        anchor_lon: f64,
        east_m: f64,
        north_m: f64,
    ) -> Result<SampleResult, DemError> {
        if !self.metadata.loaded {
            return Err(DemError::NotLoaded);
        }

        self.ensure_window(anchor_lat, anchor_lon)?;
        let window = self.window.as_ref().ok_or(DemError::NotLoaded)?;

        let point_amsl = match window.crs {
            DemHorizontalCrs::Wgs84Geographic => {
                let (lat, lon) = enu_to_geodetic(anchor_lat, anchor_lon, east_m, north_m);
                if lat < window.south_lat() || lat > window.north_lat || lon < window.west_lon || lon > window.east_lon() {
                    return Err(DemError::OutOfCoverage);
                }
                // Inside the cached window but empty/nodata cells surface as dem_nodata.
                window.sample_geographic(lat, lon).ok_or(DemError::NoData)?
            }
            DemHorizontalCrs::Epsg25832Utm32N => {
                let (anchor_easting, anchor_northing) = wgs84_to_epsg25832(anchor_lat, anchor_lon);
                let easting = anchor_easting + east_m;
                let northing = anchor_northing + north_m;
                if easting < window.west_easting
                    || easting > window.east_easting()
                    || northing < window.south_northing()
                    || northing > window.north_northing
                {
                    return Err(DemError::OutOfCoverage);
                }
                window.sample_projected(easting, northing).ok_or(DemError::NoData)?
            }
        };
        if window.is_nodata(point_amsl) {
            return Err(DemError::NoData);
        }

        let anchor_amsl = match window.crs {
            DemHorizontalCrs::Wgs84Geographic => window
                .sample_geographic(anchor_lat, anchor_lon)
                .filter(|value| !window.is_nodata(*value))
                .ok_or(DemError::NoData)?,
            DemHorizontalCrs::Epsg25832Utm32N => {
                let (anchor_easting, anchor_northing) = wgs84_to_epsg25832(anchor_lat, anchor_lon);
                window
                    .sample_projected(anchor_easting, anchor_northing)
                    .filter(|value| !window.is_nodata(*value))
                    .ok_or(DemError::NoData)?
            }
        };

        Ok(SampleResult {
            elevation_m: f64::from(point_amsl),
            elevation_enu: f64::from(point_amsl) - f64::from(anchor_amsl),
            nodata: false,
        })
    }

    fn ensure_window(&mut self, center_lat: f64, center_lon: f64) -> Result<(), DemError> {
        let needs_recenter = match &self.window {
            None => true,
            Some(window) => {
                let (east_m, north_m) = geodetic_to_enu(window.center_lat, window.center_lon, center_lat, center_lon);
                east_m.abs() > DEFAULT_WINDOW_HALF_WIDTH_M * RECENTER_MARGIN
                    || north_m.abs() > DEFAULT_WINDOW_HALF_WIDTH_M * RECENTER_MARGIN
            }
        };

        if needs_recenter {
            let crs = self.horizontal_crs.ok_or(DemError::NotLoaded)?;
            self.window = Some(build_window(
                self.geo_tiff.as_ref().ok_or(DemError::NotLoaded)?,
                center_lat,
                center_lon,
                crs,
                self.band_nodata,
            )?);
        }

        Ok(())
    }
}

struct SampleResult {
    elevation_m: f64,
    elevation_enu: f64,
    nodata: bool,
}

impl Default for DemService {
    fn default() -> Self {
        Self::new()
    }
}

impl DemWindow {
    fn south_lat(&self) -> f64 {
        self.north_lat - self.lat_step * self.rows as f64
    }

    fn east_lon(&self) -> f64 {
        self.west_lon + self.lon_step * self.cols as f64
    }

    fn east_easting(&self) -> f64 {
        self.west_easting + self.east_step * self.cols as f64
    }

    fn south_northing(&self) -> f64 {
        self.north_northing - self.north_step * self.rows as f64
    }

    fn sample_geographic(&self, lat: f64, lon: f64) -> Option<f32> {
        if self.cols < 2 || self.rows < 2 {
            return self.values.first().copied();
        }

        let col_f = (lon - self.west_lon) / self.lon_step;
        let row_f = (self.north_lat - lat) / self.lat_step;
        self.bilinear_sample(col_f, row_f)
    }

    fn sample_projected(&self, easting: f64, northing: f64) -> Option<f32> {
        if self.cols < 2 || self.rows < 2 {
            return self.values.first().copied();
        }

        let col_f = (easting - self.west_easting) / self.east_step;
        let row_f = (self.north_northing - northing) / self.north_step;
        self.bilinear_sample(col_f, row_f)
    }

    fn bilinear_sample(&self, col_f: f64, row_f: f64) -> Option<f32> {
        if col_f < 0.0 || row_f < 0.0 {
            return None;
        }

        let col = col_f.floor() as usize;
        let row = row_f.floor() as usize;
        if col + 1 >= self.cols || row + 1 >= self.rows {
            return None;
        }

        let tx = col_f - col as f64;
        let ty = row_f - row as f64;
        let idx = |c: usize, r: usize| r * self.cols + c;
        let v00 = self.values[idx(col, row)];
        let v10 = self.values[idx(col + 1, row)];
        let v01 = self.values[idx(col, row + 1)];
        let v11 = self.values[idx(col + 1, row + 1)];

        if self.is_nodata(v00) || self.is_nodata(v10) || self.is_nodata(v01) || self.is_nodata(v11) {
            return None;
        }

        let top = v00 + (v10 - v00) * tx as f32;
        let bottom = v01 + (v11 - v01) * tx as f32;
        Some(top + (bottom - top) * ty as f32)
    }

    fn is_nodata(&self, value: f32) -> bool {
        match self.nodata {
            Some(nodata) => (value - nodata).abs() < f32::EPSILON,
            None => value.is_nan(),
        }
    }
}

fn empty_metadata() -> TerrainMetadataResponse {
    TerrainMetadataResponse {
        vertical_datum: "unknown".to_string(),
        horizontal_crs: "unknown".to_string(),
        resolution_m: 0.0,
        loaded: false,
        source_path: None,
    }
}

/// Prefer GeoTIFF GeoKey EPSG codes (`geotiff` 0.1 exposes `geo_key_directory`).
/// When tags are missing, fall back to model-extent heuristics for EPSG:25832 / WGS84 tiles.
fn detect_horizontal_crs(geo_tiff: &GeoTiffReader) -> Result<(DemHorizontalCrs, String), DemError> {
    if let Some(result) = detect_horizontal_crs_from_geokeys(&geo_tiff.geo_key_directory) {
        return result;
    }

    let extent = geo_tiff.model_extent();
    let crs = infer_horizontal_crs_from_extent(&extent)?;
    Ok((crs, horizontal_crs_label(crs)))
}

fn detect_horizontal_crs_from_geokeys(
    keys: &GeoKeyDirectory,
) -> Option<Result<(DemHorizontalCrs, String), DemError>> {
    if let Some(epsg) = keys.projected_type {
        return Some(match epsg {
            25832 => Ok((DemHorizontalCrs::Epsg25832Utm32N, format!("EPSG:{epsg}"))),
            other => Err(DemError::UnsupportedCrs(format!(
                "unsupported projected CRS EPSG:{other} (supported: EPSG:25832)"
            ))),
        });
    }

    if let Some(epsg) = keys.geographic_type {
        return Some(match epsg {
            4326 => Ok((DemHorizontalCrs::Wgs84Geographic, format!("EPSG:{epsg}"))),
            other => Err(DemError::UnsupportedCrs(format!(
                "unsupported geographic CRS EPSG:{other} (supported: EPSG:4326)"
            ))),
        });
    }

    None
}

/// Extent heuristic used only when GeoKey CRS tags are absent or incomplete.
fn infer_horizontal_crs_from_extent(extent: &Rect) -> Result<DemHorizontalCrs, DemError> {
    if extent.min.x >= -180.0 && extent.max.x <= 180.0 && extent.min.y >= -90.0 && extent.max.y <= 90.0 {
        return Ok(DemHorizontalCrs::Wgs84Geographic);
    }
    if extent.min.x >= 100_000.0
        && extent.max.x <= 1_000_000.0
        && extent.min.y >= 4_000_000.0
        && extent.max.y <= 6_500_000.0
    {
        return Ok(DemHorizontalCrs::Epsg25832Utm32N);
    }
    Err(DemError::UnsupportedCrs(
        "could not detect CRS from GeoTIFF tags; model extent is outside supported EPSG:4326 / EPSG:25832 heuristics".to_string(),
    ))
}

fn horizontal_crs_label(crs: DemHorizontalCrs) -> String {
    match crs {
        DemHorizontalCrs::Wgs84Geographic => "EPSG:4326".to_string(),
        DemHorizontalCrs::Epsg25832Utm32N => "EPSG:25832".to_string(),
    }
}

const GDAL_NODATA_TAG: Tag = Tag::Unknown(42113);

/// `geotiff` 0.1 does not surface band NoData; read the GDAL ASCII tag directly.
fn read_gdal_nodata(path: &PathBuf) -> Result<Option<f32>, DemError> {
    let file = File::open(path).map_err(|error| DemError::Io(error.to_string()))?;
    let mut decoder =
        Decoder::new(BufReader::new(file)).map_err(|error| DemError::GeoTiff(error.to_string()))?;
    let Some(value) = decoder
        .find_tag(GDAL_NODATA_TAG)
        .map_err(|error| DemError::GeoTiff(error.to_string()))?
    else {
        return Ok(None);
    };
    let text = value
        .into_string()
        .map_err(|error| DemError::GeoTiff(error.to_string()))?;
    parse_gdal_nodata_value(&text)
}

fn parse_gdal_nodata_value(text: &str) -> Result<Option<f32>, DemError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    trimmed
        .parse::<f64>()
        .map(|value| Some(value as f32))
        .map_err(|_| DemError::GeoTiff(format!("invalid GDAL nodata value: {text}")))
}

fn build_window(
    geo_tiff: &GeoTiffReader,
    center_lat: f64,
    center_lon: f64,
    crs: DemHorizontalCrs,
    nodata: Option<f32>,
) -> Result<DemWindow, DemError> {
    let cols = MAX_WINDOW_SAMPLES;
    let rows = MAX_WINDOW_SAMPLES;
    let half_width = DEFAULT_WINDOW_HALF_WIDTH_M;

    let mut values = Vec::with_capacity(cols * rows);
    let (west_lon, north_lat, lon_step, lat_step, west_easting, north_northing, east_step, north_step) =
        match crs {
            DemHorizontalCrs::Wgs84Geographic => {
                let lon_step = (2.0 * half_width) / meters_per_degree_lon(center_lat) / cols as f64;
                let lat_step = (2.0 * half_width) / meters_per_degree_lat(center_lat) / rows as f64;
                let west_lon = center_lon - half_width / meters_per_degree_lon(center_lat);
                let north_lat = center_lat + half_width / meters_per_degree_lat(center_lat);

                for row in 0..rows {
                    let lat = north_lat - row as f64 * lat_step;
                    for col in 0..cols {
                        let lon = west_lon + col as f64 * lon_step;
                        let value = sample_geotiff_geographic(geo_tiff, lon, lat).unwrap_or(f32::NAN);
                        values.push(value);
                    }
                }

                (west_lon, north_lat, lon_step, lat_step, 0.0, 0.0, 0.0, 0.0)
            }
            DemHorizontalCrs::Epsg25832Utm32N => {
                let (center_easting, center_northing) = wgs84_to_epsg25832(center_lat, center_lon);
                let east_step = (2.0 * half_width) / cols as f64;
                let north_step = (2.0 * half_width) / rows as f64;
                let west_easting = center_easting - half_width;
                let north_northing = center_northing + half_width;

                for row in 0..rows {
                    let northing = north_northing - row as f64 * north_step;
                    for col in 0..cols {
                        let easting = west_easting + col as f64 * east_step;
                        let value = sample_geotiff_projected(geo_tiff, easting, northing).unwrap_or(f32::NAN);
                        values.push(value);
                    }
                }

                (
                    center_lon,
                    center_lat,
                    0.0,
                    0.0,
                    west_easting,
                    north_northing,
                    east_step,
                    north_step,
                )
            }
        };

    Ok(DemWindow {
        crs,
        center_lat,
        center_lon,
        west_lon,
        north_lat,
        cols,
        rows,
        lon_step,
        lat_step,
        west_easting,
        north_northing,
        east_step,
        north_step,
        nodata,
        values,
    })
}

fn sample_geotiff_geographic(geo_tiff: &GeoTiffReader, lon: f64, lat: f64) -> Option<f32> {
    geo_tiff.get_value_at::<f32>(&Coord { x: lon, y: lat }, 0)
}

fn sample_geotiff_projected(geo_tiff: &GeoTiffReader, easting: f64, northing: f64) -> Option<f32> {
    geo_tiff.get_value_at::<f32>(&Coord { x: easting, y: northing }, 0)
}

fn dem_failure_reason(error: &DemError) -> Option<String> {
    match error {
        DemError::OutOfCoverage => Some("dem_out_of_coverage".to_string()),
        DemError::NoData => Some("dem_nodata".to_string()),
        _ => None,
    }
}

fn estimate_resolution_m(geo_tiff: &GeoTiffReader, extent: &Rect, crs: DemHorizontalCrs) -> f64 {
    estimate_resolution_for_raster(extent, crs, geo_tiff.raster_width, geo_tiff.raster_height)
}

fn estimate_resolution_for_raster(
    extent: &Rect,
    crs: DemHorizontalCrs,
    raster_width: usize,
    raster_height: usize,
) -> f64 {
    if raster_width <= 1 || raster_height <= 1 {
        return 0.0;
    }

    match crs {
        DemHorizontalCrs::Epsg25832Utm32N => {
            let width_m = (extent.max.x - extent.min.x).abs();
            let height_m = (extent.max.y - extent.min.y).abs();
            let res_x = width_m / raster_width as f64;
            let res_y = height_m / raster_height as f64;
            res_x.max(res_y)
        }
        DemHorizontalCrs::Wgs84Geographic => {
            let lon_span = (extent.max.x - extent.min.x).abs();
            let lat_span = (extent.max.y - extent.min.y).abs();
            let lon_res = lon_span / raster_width as f64;
            let lat_res = lat_span / raster_height as f64;
            let mid_lat = (extent.max.y + extent.min.y) * 0.5;
            ((lon_res * meters_per_degree_lon(mid_lat)).abs()
                + (lat_res * meters_per_degree_lat(mid_lat)).abs())
                * 0.5
        }
    }
}

const WGS84_A: f64 = 6_378_137.0;
const WGS84_E2: f64 = 0.006_694_379_990_14;

fn meters_per_degree_lat(lat_deg: f64) -> f64 {
    let lat_rad = lat_deg.to_radians();
    let sin_lat = lat_rad.sin();
    let denom = (1.0 - WGS84_E2 * sin_lat * sin_lat).sqrt();
    let m1 = (WGS84_A * (1.0 - WGS84_E2)) / (denom * denom * denom);
    let m2 = WGS84_A / denom;
    (m1 * m2).sqrt()
}

fn meters_per_degree_lon(lat_deg: f64) -> f64 {
    meters_per_degree_lat(lat_deg) * lat_deg.to_radians().cos()
}

fn enu_to_geodetic(anchor_lat: f64, anchor_lon: f64, east_m: f64, north_m: f64) -> (f64, f64) {
    let lat = anchor_lat + north_m / meters_per_degree_lat(anchor_lat);
    let lon = anchor_lon + east_m / meters_per_degree_lon(anchor_lat);
    (lat, lon)
}

fn geodetic_to_enu(anchor_lat: f64, anchor_lon: f64, lat: f64, lon: f64) -> (f64, f64) {
    let east_m = (lon - anchor_lon) * meters_per_degree_lon(anchor_lat);
    let north_m = (lat - anchor_lat) * meters_per_degree_lat(anchor_lat);
    (east_m, north_m)
}

/// WGS84 geodetic coordinates to EPSG:25832 (ETRS89 / UTM zone 32N) easting/northing meters.
fn wgs84_to_epsg25832(lat_deg: f64, lon_deg: f64) -> (f64, f64) {
    const ZONE: i32 = 32;
    const FALSE_EASTING: f64 = 500_000.0;
    const SCALE: f64 = 0.9996;
    const K0: f64 = SCALE;

    let lat = lat_deg.to_radians();
    let lon = lon_deg.to_radians();
    let lon_origin = (((ZONE - 1) * 6 - 180 + 3) as f64).to_radians();

    let sin_lat = lat.sin();
    let cos_lat = lat.cos();
    let tan_lat = lat.tan();

    let e2 = WGS84_E2;
    let ep2 = e2 / (1.0 - e2);
    let n = WGS84_A / (1.0 - e2 * sin_lat * sin_lat).sqrt();
    let t = tan_lat * tan_lat;
    let c = ep2 * cos_lat * cos_lat;
    let a = (lon - lon_origin) * cos_lat;

    let m = WGS84_A
        * ((1.0 - e2 / 4.0 - 3.0 * e2 * e2 / 64.0 - 5.0 * e2 * e2 * e2 / 256.0) * lat
            - (3.0 * e2 / 8.0 + 3.0 * e2 * e2 / 32.0 + 45.0 * e2 * e2 * e2 / 1024.0) * (2.0 * lat).sin()
            + (15.0 * e2 * e2 / 256.0 + 45.0 * e2 * e2 * e2 / 1024.0) * (4.0 * lat).sin()
            - (35.0 * e2 * e2 * e2 / 3072.0) * (6.0 * lat).sin());

    let easting = FALSE_EASTING
        + K0
            * n
            * (a + (1.0 - t + c) * a.powi(3) / 6.0
                + (5.0 - 18.0 * t + t * t + 72.0 * c - 58.0 * ep2) * a.powi(5) / 120.0);
    let northing = K0
        * (m + n
            * tan_lat
            * (a * a / 2.0
                + (5.0 - t + 9.0 * c + 4.0 * c * c) * a.powi(4) / 24.0
                + (61.0 - 58.0 * t + t * t + 600.0 * c - 330.0 * ep2) * a.powi(6) / 720.0));

    (easting, northing)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enu_roundtrip_is_consistent_near_anchor() {
        let anchor_lat = 50.0;
        let anchor_lon = 10.0;
        let (lat, lon) = enu_to_geodetic(anchor_lat, anchor_lon, 120.0, -80.0);
        let (east_m, north_m) = geodetic_to_enu(anchor_lat, anchor_lon, lat, lon);
        assert!((east_m - 120.0).abs() < 0.01);
        assert!((north_m + 80.0).abs() < 0.01);
    }

    #[test]
    fn wgs84_to_epsg25832_matches_reference_point() {
        // Generic UTM32N reference — expected easting/northing within ~1 m of recomputed values.
        let (easting, northing) = wgs84_to_epsg25832(50.0, 10.0);
        assert!((easting - 571_666.0).abs() < 2.0);
        assert!((northing - 5_539_110.0).abs() < 2.0);
    }

    #[test]
    fn projected_resolution_uses_extent_meters() {
        let extent = Rect::new(
            Coord { x: 400_000.0, y: 5_200_000.0 },
            Coord { x: 500_000.0, y: 5_300_000.0 },
        );
        let resolution =
            estimate_resolution_for_raster(&extent, DemHorizontalCrs::Epsg25832Utm32N, 1000, 2000);
        assert!((resolution - 100.0).abs() < 0.01);
    }

    #[test]
    fn projected_extent_heuristic_classifies_epsg25832() {
        let extent = Rect::new(
            Coord { x: 400_000.0, y: 5_200_000.0 },
            Coord { x: 900_000.0, y: 5_500_000.0 },
        );
        assert_eq!(
            infer_horizontal_crs_from_extent(&extent).expect("utm extent"),
            DemHorizontalCrs::Epsg25832Utm32N
        );
    }

    #[test]
    fn geokeys_prefer_projected_epsg25832_over_extent() {
        let mut keys = GeoKeyDirectory::default();
        keys.projected_type = Some(25832);
        let result = detect_horizontal_crs_from_geokeys(&keys).expect("tagged").expect("ok");
        assert_eq!(result.0, DemHorizontalCrs::Epsg25832Utm32N);
        assert_eq!(result.1, "EPSG:25832");
    }

    #[test]
    fn geokeys_prefer_geographic_epsg4326() {
        let mut keys = GeoKeyDirectory::default();
        keys.geographic_type = Some(4326);
        let result = detect_horizontal_crs_from_geokeys(&keys).expect("tagged").expect("ok");
        assert_eq!(result.0, DemHorizontalCrs::Wgs84Geographic);
        assert_eq!(result.1, "EPSG:4326");
    }

    #[test]
    fn unsupported_geokey_epsg_fails_at_detection() {
        let mut keys = GeoKeyDirectory::default();
        keys.projected_type = Some(32632);
        let error = detect_horizontal_crs_from_geokeys(&keys)
            .expect("tagged")
            .expect_err("unsupported");
        assert!(matches!(error, DemError::UnsupportedCrs(_)));
    }

    #[test]
    fn unknown_extent_without_geokeys_is_unsupported() {
        let extent = Rect::new(Coord { x: 0.0, y: 0.0 }, Coord { x: 10_000.0, y: 10_000.0 });
        assert!(matches!(
            infer_horizontal_crs_from_extent(&extent),
            Err(DemError::UnsupportedCrs(_))
        ));
    }

    #[test]
    fn parses_gdal_nodata_ascii_tag() {
        assert_eq!(
            parse_gdal_nodata_value("-9999").expect("parse"),
            Some(-9999.0_f32)
        );
    }

    #[test]
    fn nodata_corners_surface_as_nodata_not_coverage() {
        let window = DemWindow {
            crs: DemHorizontalCrs::Wgs84Geographic,
            center_lat: 50.0,
            center_lon: 10.0,
            west_lon: 10.0,
            north_lat: 50.0001,
            cols: 2,
            rows: 2,
            lon_step: 0.0001,
            lat_step: 0.0001,
            west_easting: 0.0,
            north_northing: 0.0,
            east_step: 0.0,
            north_step: 0.0,
            nodata: Some(-9999.0),
            values: vec![100.0, -9999.0, 100.0, 100.0],
        };
        // Bilinear patch includes a -9999 corner -> dem_nodata, not dem_out_of_coverage.
        assert!(window.sample_geographic(50.0, 10.00005).is_none());
        assert_eq!(dem_failure_reason(&DemError::NoData), Some("dem_nodata".to_string()));
        assert_eq!(
            dem_failure_reason(&DemError::OutOfCoverage),
            Some("dem_out_of_coverage".to_string())
        );
    }
}

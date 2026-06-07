//! Local DEM window cache and GeoTIFF elevation sampling for target estimation.

use geo_types::{Coord, Rect};
use geotiff::GeoTiff;
use serde::{Deserialize, Serialize};
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

type GeoTiffReader = GeoTiff;

pub struct DemService {
    geo_tiff: Option<GeoTiffReader>,
    metadata: TerrainMetadataResponse,
    window: Option<DemWindow>,
}

struct DemWindow {
    center_lat: f64,
    center_lon: f64,
    west_lon: f64,
    north_lat: f64,
    cols: usize,
    rows: usize,
    lon_step: f64,
    lat_step: f64,
    nodata: Option<f32>,
    values: Vec<f32>,
}

#[derive(Debug)]
pub enum DemError {
    NotLoaded,
    OutOfCoverage,
    NoData,
    InvalidArgument(String),
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

        let file = File::open(&source_path).map_err(|error| DemError::Io(error.to_string()))?;
        let reader = BufReader::new(file);
        let geo_tiff = GeoTiff::read(reader).map_err(|error| DemError::GeoTiff(error.to_string()))?;

        let extent = geo_tiff.model_extent();
        let resolution_m = estimate_resolution_m(&geo_tiff, &extent);
        let horizontal_crs = infer_horizontal_crs(&extent);

        self.geo_tiff = Some(geo_tiff);
        self.window = None;
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

    pub fn get_elevations_along_ray(
        &mut self,
        anchor_lat: f64,
        anchor_lon: f64,
        origin: EnuPoint,
        direction: EnuPoint,
        distances_m: Vec<f64>,
    ) -> Result<Vec<Option<TerrainRaySampleResponse>>, DemError> {
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
                Ok(sample) => samples.push(Some(TerrainRaySampleResponse {
                    distance_m,
                    enu: [east_m, north_m, up_m],
                    elevation_m: sample.elevation_enu,
                    nodata: false,
                })),
                Err(DemError::OutOfCoverage) | Err(DemError::NoData) => samples.push(None),
                Err(error) => return Err(error),
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

        let (lat, lon) = enu_to_geodetic(anchor_lat, anchor_lon, east_m, north_m);
        self.ensure_window(anchor_lat, anchor_lon)?;
        let window = self.window.as_ref().ok_or(DemError::NotLoaded)?;

        if lat < window.south_lat() || lat > window.north_lat || lon < window.west_lon || lon > window.east_lon() {
            return Err(DemError::OutOfCoverage);
        }

        let point_amsl = window.sample(lat, lon).ok_or(DemError::NoData)?;
        if window.is_nodata(point_amsl) {
            return Err(DemError::NoData);
        }

        let anchor_amsl = window
            .sample(anchor_lat, anchor_lon)
            .filter(|value| !window.is_nodata(*value))
            .ok_or(DemError::NoData)?;

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
            self.window = Some(build_window(
                self.geo_tiff.as_ref().ok_or(DemError::NotLoaded)?,
                center_lat,
                center_lon,
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

    fn sample(&self, lat: f64, lon: f64) -> Option<f32> {
        if self.cols < 2 || self.rows < 2 {
            return self.values.first().copied();
        }

        let col_f = (lon - self.west_lon) / self.lon_step;
        let row_f = (self.north_lat - lat) / self.lat_step;
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

fn infer_horizontal_crs(extent: &Rect) -> String {
    if extent.min.x >= -180.0 && extent.max.x <= 180.0 && extent.min.y >= -90.0 && extent.max.y <= 90.0 {
        "EPSG:4326".to_string()
    } else {
        "GeoTIFF-Projected".to_string()
    }
}

fn build_window(geo_tiff: &GeoTiffReader, center_lat: f64, center_lon: f64) -> Result<DemWindow, DemError> {
    let cols = MAX_WINDOW_SAMPLES;
    let rows = MAX_WINDOW_SAMPLES;
    let half_width = DEFAULT_WINDOW_HALF_WIDTH_M;
    let lon_step = (2.0 * half_width) / meters_per_degree_lon(center_lat) / cols as f64;
    let lat_step = (2.0 * half_width) / meters_per_degree_lat(center_lat) / rows as f64;
    let west_lon = center_lon - half_width / meters_per_degree_lon(center_lat);
    let north_lat = center_lat + half_width / meters_per_degree_lat(center_lat);

    let mut values = Vec::with_capacity(cols * rows);
    for row in 0..rows {
        let lat = north_lat - row as f64 * lat_step;
        for col in 0..cols {
            let lon = west_lon + col as f64 * lon_step;
            let value = sample_geotiff(geo_tiff, lat, lon).unwrap_or(f32::NAN);
            values.push(value);
        }
    }

    Ok(DemWindow {
        center_lat,
        center_lon,
        west_lon,
        north_lat,
        cols,
        rows,
        lon_step,
        lat_step,
        nodata: None,
        values,
    })
}

fn sample_geotiff(geo_tiff: &GeoTiffReader, lat: f64, lon: f64) -> Option<f32> {
    geo_tiff.get_value_at::<f32>(&Coord { x: lon, y: lat }, 0)
}

fn estimate_resolution_m(geo_tiff: &GeoTiffReader, extent: &Rect) -> f64 {
    if geo_tiff.raster_width <= 1 || geo_tiff.raster_height <= 1 {
        return 0.0;
    }
    let lon_span = (extent.max.x - extent.min.x).abs();
    let lat_span = (extent.max.y - extent.min.y).abs();
    let lon_res = lon_span / geo_tiff.raster_width as f64;
    let lat_res = lat_span / geo_tiff.raster_height as f64;
    let mid_lat = (extent.max.y + extent.min.y) * 0.5;
    ((lon_res * meters_per_degree_lon(mid_lat)).abs() + (lat_res * meters_per_degree_lat(mid_lat)).abs()) * 0.5
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
}

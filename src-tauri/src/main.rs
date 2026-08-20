// Prevents additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod map_engine;

use map_engine::{parse_pbf_bbox, HighwaySegment};

/// Tauri IPC command: load highway segments from a local `.pbf` file clipped to the
/// supplied bounding box.  Returned segments are sorted ground-first (layer=0) through
/// the highest flyover tier so the renderer can draw them in the correct stacking order.
#[tauri::command]
fn load_pbf_bbox(
    pbf_path: String,
    min_lon: f64,
    min_lat: f64,
    max_lon: f64,
    max_lat: f64,
) -> Result<Vec<HighwaySegment>, String> {
    parse_pbf_bbox(&pbf_path, min_lon, min_lat, max_lon, max_lat)
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![load_pbf_bbox])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

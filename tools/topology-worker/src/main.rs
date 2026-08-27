use std::{env, fs::File, io::BufWriter, path::PathBuf};

use anyhow::{Context, Result, bail};
use abstio::MapName;
use abstutil::Timer;
use convert_osm::{Options, convert};
use osm2streets::{StreetNetwork, Transformation};
use serde_json::{Value, json};

fn main() -> Result<()> {
    let arguments: Vec<String> = env::args().collect();
    if !(3..=4).contains(&arguments.len()) {
        bail!("usage: magnus-topology-worker <input.pbf> <output.json> [clip.geojson]");
    }

    let input = arguments[1].clone();
    let output = PathBuf::from(&arguments[2]);
    let clip = arguments.get(3).cloned();
    let mut timer = Timer::throwaway();
    let mut map = convert(input, MapName::new("us", "magnus", "topology"), clip, Options::default(), &mut timer);
    map.streets.apply_transformations(
        vec![
            Transformation::RemoveDisconnectedRoads,
            Transformation::CollapseShortRoads,
            Transformation::CollapseDegenerateIntersections,
        ],
        &mut timer,
    );

    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let writer = BufWriter::new(File::create(&output)?);
    serde_json::to_writer_pretty(writer, &topology_scene(&map.streets))
        .with_context(|| format!("failed to write {}", output.display()))?;
    println!("exported normalized topology to {}", output.display());
    Ok(())
}

fn topology_scene(streets: &StreetNetwork) -> Value {
    let serialized = serde_json::to_value(streets).expect("StreetNetwork should serialize");
    let roads = serialized["roads"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.as_array()?.get(1))
        .map(|road| {
            json!({
                "sourceWayIds": road["osm_ids"],
                "layer": road["layer"],
                "highway": road["highway_type"],
                "laneCount": road["lane_specs_ltr"].as_array().map_or(1, Vec::len),
                "centerLine": points(&road["center_line"]["pts"]),
                "widthFeet": meters_to_feet(sum_lane_widths(&road["lane_specs_ltr"])),
                "trimStartFeet": serialized_distance_to_feet(&road["trim_start"]),
                "trimEndFeet": serialized_distance_to_feet(&road["trim_end"]),
            })
        })
        .collect::<Vec<_>>();
    let intersections = serialized["intersections"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.as_array()?.get(1))
        .map(|intersection| {
            json!({
                "sourceNodeIds": intersection["osm_ids"],
                "polygon": points(&intersection["polygon"]["rings"][0]["pts"]),
            })
        })
        .collect::<Vec<_>>();
    json!({
        "version": 1,
        "coordinateUnits": "feet",
        "roads": roads,
        "intersections": intersections,
    })
}

fn points(value: &Value) -> Vec<[f64; 2]> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|point| {
            Some([
                serialized_distance_to_feet(&point["x"]),
                serialized_distance_to_feet(&point["y"]),
            ])
        })
        .collect()
}

fn sum_lane_widths(value: &Value) -> f64 {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|lane| lane["width"].as_f64())
        .sum()
}

fn serialized_distance_to_feet(value: &Value) -> f64 {
    value.as_f64().unwrap_or(0.0) / 10_000.0 * 3.280_839_895
}

fn meters_to_feet(value: f64) -> f64 {
    value / 10_000.0 * 3.280_839_895
}
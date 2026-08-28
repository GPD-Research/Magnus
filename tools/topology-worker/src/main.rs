use std::{collections::HashMap, env, fs::File, io::BufWriter, path::PathBuf};

use abstio::MapName;
use abstutil::Timer;
use anyhow::{bail, Context, Result};
use convert_osm::{convert, Options};
use geojson::{GeoJson, Value as GeoJsonValue};
use geom::{GPSBounds, LonLat};
use magnus_spatial_core::topology::{
    classify_road_relationship, CrossingCandidate, RoadRelationship, RoadStructure,
};
use osm2streets::{Filter, StreetNetwork, Transformation};
use serde_json::{json, Value};

fn main() -> Result<()> {
    let arguments: Vec<String> = env::args().collect();
    if !(3..=4).contains(&arguments.len()) {
        bail!("usage: magnus-topology-worker <input.pbf> <output.json> [clip.geojson]");
    }

    let input = arguments[1].clone();
    let output = PathBuf::from(&arguments[2]);
    let clip = arguments.get(3).cloned();
    let mut timer = Timer::throwaway();
    let mut map = convert(
        input,
        MapName::new("us", "magnus", "topology"),
        clip,
        Options::default(),
        &mut timer,
    );
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
    serde_json::to_writer_pretty(writer, &topology_scene(&map.streets)?)
        .with_context(|| format!("failed to write {}", output.display()))?;
    println!("exported normalized topology to {}", output.display());
    Ok(())
}

fn topology_scene(streets: &StreetNetwork) -> Result<Value> {
    let serialized = serde_json::to_value(streets).expect("StreetNetwork should serialize");
    let serialized_intersections = &serialized["intersections"];
    let road_structures = road_structures(&serialized["roads"]);
    let roads = serialized["roads"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.as_array()?.get(1))
        .map(|road| {
            let center_line = points(&road["center_line"]["pts"]);
            let width_feet = meters_to_feet(sum_lane_widths(&road["lane_specs_ltr"]));
            json!({
                "sourceWayIds": road["osm_ids"],
                "endpointNodeIds": source_endpoint_node_ids(road, serialized_intersections),
                "layer": road["layer"],
                "highway": road["highway_type"],
                "laneCount": road["lane_specs_ltr"].as_array().map_or(1, Vec::len),
                "laneRecords": lane_records(&road["lane_specs_ltr"]),
                "centerLine": center_line,
                "surfacePolygon": ribbon(&center_line, width_feet),
                "widthFeet": width_feet,
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
                "relationship": intersection_relationship(intersection, &road_structures),
                "polygon": points(&intersection["polygon"]["rings"][0]["pts"]),
            })
        })
        .collect::<Vec<_>>();
    let markings = streets
        .to_lane_markings_geojson(&Filter::All)
        .map_err(|error| anyhow::anyhow!(error))?;
    let markings = semantic_markings(&markings, &streets.gps_bounds, &serialized["roads"])?;
    Ok(json!({
        "version": 1,
        "coordinateUnits": "feet",
        "roads": roads,
        "intersections": intersections,
        "markings": markings,
    }))
}

fn road_structures(roads: &Value) -> HashMap<i64, RoadStructure> {
    roads
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let road = entry.get(1)?;
            Some((
                entry.get(0)?.as_i64()?,
                RoadStructure {
                    layer: road["layer"].as_i64()? as i16,
                    bridge: false,
                    tunnel: false,
                },
            ))
        })
        .collect()
}

fn intersection_relationship(
    intersection: &Value,
    road_structures: &HashMap<i64, RoadStructure>,
) -> Option<&'static str> {
    let roads = intersection["roads"].as_array()?;
    let first = road_structures.get(&roads.first()?.as_i64()?)?;
    let second = road_structures.get(&roads.get(1)?.as_i64()?)?;
    let shared_node_ids = intersection["osm_ids"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_i64)
        .collect();
    match classify_road_relationship(CrossingCandidate {
        shared_node_ids,
        first: *first,
        second: *second,
    }) {
        RoadRelationship::ConnectedAtNode { .. } => Some("connected-at-node"),
        RoadRelationship::GradeSeparated { .. } => Some("grade-separated"),
        RoadRelationship::Unresolved { .. } => Some("unresolved"),
    }
}

fn source_endpoint_node_ids(road: &Value, intersections: &Value) -> Vec<i64> {
    ["src_i", "dst_i"]
        .into_iter()
        .filter_map(|endpoint| road[endpoint].as_i64())
        .filter_map(|intersection_id| {
            intersections
                .as_array()?
                .iter()
                .find(|entry| entry.get(0).and_then(Value::as_i64) == Some(intersection_id))
                .and_then(|entry| entry.get(1))
                .and_then(|intersection| intersection["osm_ids"].as_array())
                .and_then(|node_ids| node_ids.first())
                .and_then(Value::as_i64)
        })
        .collect()
}

fn lane_records(value: &Value) -> Vec<Value> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .map(|lane| {
            json!({
                "laneType": lane["lt"].as_str().unwrap_or("unknown").to_ascii_lowercase(),
                "direction": lane["dir"].as_str().unwrap_or("unknown").to_ascii_lowercase(),
                "widthFeet": serialized_distance_to_feet(&lane["width"]),
                "sourceEvidence": {
                    "lane": lane["lane"],
                    "allowedTurns": lane["allowed_turns"],
                },
            })
        })
        .collect()
}

fn semantic_markings(markings: &str, bounds: &GPSBounds, roads: &Value) -> Result<Vec<Value>> {
    let Ok(GeoJson::FeatureCollection(collection)) = markings.parse::<GeoJson>() else {
        bail!("topology markings are not a feature collection");
    };
    let source_ids = roads
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let road = entry.as_array()?.get(1)?;
            Some((road["id"].as_i64()?, road["osm_ids"].clone()))
        })
        .collect::<std::collections::HashMap<_, _>>();
    let mut output = Vec::new();
    for feature in collection.features {
        let Some(geometry) = feature.geometry.clone() else {
            continue;
        };
        let kind = feature
            .property("type")
            .and_then(Value::as_str)
            .unwrap_or("semantic marking");
        let road_id = feature.property("road").and_then(Value::as_i64);
        let source_way_ids = road_id
            .and_then(|id| source_ids.get(&id).cloned())
            .unwrap_or_else(|| json!([]));
        match geometry.value {
            GeoJsonValue::Polygon(rings) => {
                for ring in rings {
                    output.push(json!({
                        "type": kind,
                        "sourceWayIds": source_way_ids,
                        "geometry": ring.into_iter().map(|point| local_point(point, bounds)).collect::<Vec<_>>(),
                    }));
                }
            }
            GeoJsonValue::MultiPolygon(polygons) => {
                for polygon in polygons {
                    for ring in polygon {
                        output.push(json!({
                            "type": kind,
                            "sourceWayIds": source_way_ids,
                            "geometry": ring.into_iter().map(|point| local_point(point, bounds)).collect::<Vec<_>>(),
                        }));
                    }
                }
            }
            _ => {}
        }
    }
    Ok(output)
}

fn local_point(point: Vec<f64>, bounds: &GPSBounds) -> [f64; 2] {
    let longitude = point.first().copied().unwrap_or_default();
    let latitude = point.get(1).copied().unwrap_or_default();
    let point = LonLat::new(longitude, latitude).to_pt(bounds);
    [point.x() * 3.280_839_895, point.y() * 3.280_839_895]
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

fn ribbon(points: &[[f64; 2]], width_feet: f64) -> Vec<[f64; 2]> {
    if points.len() < 2 || width_feet <= 0.0 {
        return Vec::new();
    }
    let half_width = width_feet / 2.0;
    let mut left = Vec::with_capacity(points.len());
    let mut right = Vec::with_capacity(points.len());
    for (index, point) in points.iter().enumerate() {
        let previous = points[index.saturating_sub(1)];
        let next = points[(index + 1).min(points.len() - 1)];
        let delta = [next[0] - previous[0], next[1] - previous[1]];
        let length = delta[0].hypot(delta[1]);
        let normal = if length <= 1e-9 {
            [0.0, 0.0]
        } else {
            [
                -delta[1] / length * half_width,
                delta[0] / length * half_width,
            ]
        };
        left.push([point[0] + normal[0], point[1] + normal[1]]);
        right.push([point[0] - normal[0], point[1] - normal[1]]);
    }
    left.extend(right.into_iter().rev());
    left.push(left[0]);
    left
}

use std::{
    collections::{BTreeMap, HashMap},
    env,
    fs::File,
    io::BufWriter,
    path::PathBuf,
};

use abstio::MapName;
use abstutil::{Tags, Timer};
use anyhow::{bail, Context, Result};
use convert_osm::{convert, Options};
use geojson::{GeoJson, Value as GeoJsonValue};
use geom::{GPSBounds, LonLat};
use magnus_spatial_core::topology::{
    classify_road_relationship, CrossingCandidate, RoadRelationship, RoadStructure,
};
use osm2streets::{osm::WayID, Filter, StreetNetwork, Transformation};
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
    serde_json::to_writer_pretty(writer, &topology_scene(&map.streets, &map.osm_tags)?)
        .with_context(|| format!("failed to write {}", output.display()))?;
    println!("exported normalized topology to {}", output.display());
    Ok(())
}

fn topology_scene(streets: &StreetNetwork, osm_tags: &BTreeMap<WayID, Tags>) -> Result<Value> {
    let serialized = serde_json::to_value(streets).expect("StreetNetwork should serialize");
    let serialized_intersections = &serialized["intersections"];
    let road_structures = road_structures(&serialized["roads"], osm_tags);
    let road_polygons = normalized_road_polygons(streets);
    let gore_breaks = gore_fog_line_breaks(&serialized["roads"], serialized_intersections);
    let mut fog_line_markings = Vec::new();
    let roads = serialized["roads"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.as_array()?.get(1))
        .map(|road| {
            let center_line = points(&road["center_line"]["pts"]);
            let width_feet = meters_to_feet(sum_lane_widths(&road["lane_specs_ltr"]));
            let (bridge, tunnel) = structural_tags(&road["osm_ids"], osm_tags);
            let surface_polygon = road["id"]
                .as_i64()
                .and_then(|id| road_polygons.get(&id).cloned())
                .unwrap_or_else(|| ribbon(&center_line, width_feet));
            let (left_shoulder_feet, right_shoulder_feet) =
                shoulder_widths_feet(&road["lane_specs_ltr"]);
            let (start_break, end_break) = road["id"]
                .as_i64()
                .and_then(|id| gore_breaks.get(&id))
                .copied()
                .unwrap_or((None, None));
            fog_line_markings.extend(fog_line_markings_for_road(
                &road["osm_ids"],
                road["layer"].as_i64().unwrap_or(0) as i16,
                &center_line,
                width_feet,
                left_shoulder_feet,
                right_shoulder_feet,
                start_break,
                end_break,
            ));
            json!({
                "sourceWayIds": road["osm_ids"],
                "endpointNodeIds": source_endpoint_node_ids(road, serialized_intersections),
                "layer": road["layer"],
                "highway": road["highway_type"],
                "laneCount": road["lane_specs_ltr"].as_array().map_or(1, Vec::len),
                "laneRecords": lane_records(&road["lane_specs_ltr"]),
                "bridge": bridge,
                "tunnel": tunnel,
                "centerLine": center_line,
                "surfacePolygon": surface_polygon,
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
            let relationships = intersection_relationships(intersection, &road_structures);
            json!({
                "sourceNodeIds": intersection["osm_ids"],
                "connectedRoadIds": intersection["roads"],
                "layer": intersection_layer(intersection, &road_structures),
                "relationship": relationships.first().and_then(|record| record["kind"].as_str()),
                "relationships": relationships,
                "polygon": points(&intersection["polygon"]["rings"][0]["pts"]),
            })
        })
        .collect::<Vec<_>>();
    let diagnostics = non_intersection_diagnostics(&serialized["roads"], &road_structures);
    let markings = streets
        .to_lane_markings_geojson(&Filter::All)
        .map_err(|error| anyhow::anyhow!(error))?;
    let mut markings = semantic_markings(&markings, &streets.gps_bounds, &serialized["roads"])?;
    markings.extend(fog_line_markings);
    Ok(json!({
        "version": 1,
        "coordinateUnits": "feet",
        "normalizedTopology": serialized,
        "roads": roads,
        "intersections": intersections,
        "markings": markings,
        "diagnostics": diagnostics,
    }))
}

fn intersection_layer(
    intersection: &Value,
    road_structures: &HashMap<i64, RoadStructure>,
) -> i16 {
    intersection["roads"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_i64)
        .filter_map(|road_id| road_structures.get(&road_id).map(|structure| structure.layer))
        .min()
        .map_or(-1, |layer| layer.saturating_sub(1))
}

fn normalized_road_polygons(streets: &StreetNetwork) -> HashMap<i64, Vec<[f64; 2]>> {
    streets
        .roads
        .iter()
        .map(|(id, road)| {
            let polygon = road
                .center_line
                .make_polygons(road.total_width())
                .get_outer_ring()
                .points()
                .iter()
                .map(|point| [point.x() * 3.280_839_895, point.y() * 3.280_839_895])
                .collect();
            (id.0 as i64, polygon)
        })
        .collect()
}

fn non_intersection_diagnostics(
    roads: &Value,
    road_structures: &HashMap<i64, RoadStructure>,
) -> Vec<Value> {
    let Some(roads) = roads.as_array() else {
        return Vec::new();
    };
    let mut diagnostics = Vec::new();
    for first_index in 0..roads.len() {
        for second_index in (first_index + 1)..roads.len() {
            let Some(first_entry) = roads[first_index].as_array() else {
                continue;
            };
            let Some(second_entry) = roads[second_index].as_array() else {
                continue;
            };
            let Some(first_id) = first_entry.first().and_then(Value::as_i64) else {
                continue;
            };
            let Some(second_id) = second_entry.first().and_then(Value::as_i64) else {
                continue;
            };
            let Some(first) = first_entry.get(1) else {
                continue;
            };
            let Some(second) = second_entry.get(1) else {
                continue;
            };
            if share_normalized_endpoint(first, second) {
                continue;
            }
            let Some(crossing_point) = line_crossing_point(
                &points(&first["center_line"]["pts"]),
                &points(&second["center_line"]["pts"]),
            ) else {
                continue;
            };
            let Some(first_structure) = road_structures.get(&first_id) else {
                continue;
            };
            let Some(second_structure) = road_structures.get(&second_id) else {
                continue;
            };
            let kind = match classify_road_relationship(CrossingCandidate {
                shared_node_ids: Vec::new(),
                first: *first_structure,
                second: *second_structure,
            }) {
                RoadRelationship::GradeSeparated { .. } => "grade-separated",
                RoadRelationship::Unresolved { .. } => "unresolved",
                RoadRelationship::ConnectedAtNode { .. } => continue,
            };
            let mut source_way_ids = first["osm_ids"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_i64)
                .chain(
                    second["osm_ids"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_i64),
                )
                .collect::<Vec<_>>();
            source_way_ids.sort_unstable();
            source_way_ids.dedup();
            diagnostics.push(json!({
                "kind": kind,
                "roadIds": [first_id, second_id],
                "sourceWayIds": source_way_ids,
                "crossingPoint": crossing_point,
            }));
        }
    }
    diagnostics
}

fn share_normalized_endpoint(first: &Value, second: &Value) -> bool {
    let first_endpoints = [first["src_i"].as_i64(), first["dst_i"].as_i64()];
    let second_endpoints = [second["src_i"].as_i64(), second["dst_i"].as_i64()];
    first_endpoints.into_iter().flatten().any(|first_id| {
        second_endpoints
            .into_iter()
            .flatten()
            .any(|second_id| first_id == second_id)
    })
}

fn line_crossing_point(first: &[[f64; 2]], second: &[[f64; 2]]) -> Option<[f64; 2]> {
    for first_segment in first.windows(2) {
        for second_segment in second.windows(2) {
            if let Some(point) = segment_crossing_point(first_segment, second_segment) {
                return Some(point);
            }
        }
    }
    None
}

fn segment_crossing_point(first: &[[f64; 2]], second: &[[f64; 2]]) -> Option<[f64; 2]> {
    let origin = first[0];
    let first_vector = [first[1][0] - origin[0], first[1][1] - origin[1]];
    let second_origin = second[0];
    let second_vector = [
        second[1][0] - second_origin[0],
        second[1][1] - second_origin[1],
    ];
    let denominator = cross(first_vector, second_vector);
    if denominator.abs() <= f64::EPSILON {
        return None;
    }
    let offset = [second_origin[0] - origin[0], second_origin[1] - origin[1]];
    let first_distance = cross(offset, second_vector) / denominator;
    let second_distance = cross(offset, first_vector) / denominator;
    if !(0.0..=1.0).contains(&first_distance) || !(0.0..=1.0).contains(&second_distance) {
        return None;
    }
    Some([
        origin[0] + first_vector[0] * first_distance,
        origin[1] + first_vector[1] * first_distance,
    ])
}

fn cross(first: [f64; 2], second: [f64; 2]) -> f64 {
    first[0] * second[1] - first[1] * second[0]
}

fn road_structures(roads: &Value, osm_tags: &BTreeMap<WayID, Tags>) -> HashMap<i64, RoadStructure> {
    roads
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let road = entry.get(1)?;
            let (bridge, tunnel) = structural_tags(&road["osm_ids"], osm_tags);
            Some((
                entry.get(0)?.as_i64()?,
                RoadStructure {
                    layer: road["layer"].as_i64()? as i16,
                    bridge,
                    tunnel,
                },
            ))
        })
        .collect()
}

fn structural_tags(
    source_way_ids: &Value,
    osm_tags: &BTreeMap<WayID, Tags>,
) -> (Option<bool>, Option<bool>) {
    (
        structural_tag(source_way_ids, osm_tags, "bridge"),
        structural_tag(source_way_ids, osm_tags, "tunnel"),
    )
}

fn structural_tag(
    source_way_ids: &Value,
    osm_tags: &BTreeMap<WayID, Tags>,
    key: &str,
) -> Option<bool> {
    let mut found = false;
    for source_way_id in source_way_ids
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_i64)
    {
        let Some(tags) = osm_tags.get(&WayID(source_way_id)) else {
            continue;
        };
        found = true;
        if tags.get(key).is_some_and(|value| value != "no") {
            return Some(true);
        }
    }
    found.then_some(false)
}

fn intersection_relationships(
    intersection: &Value,
    road_structures: &HashMap<i64, RoadStructure>,
) -> Vec<Value> {
    let Some(roads) = intersection["roads"].as_array() else {
        return Vec::new();
    };
    let shared_node_ids: Vec<i64> = intersection["osm_ids"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_i64)
        .collect();
    let mut relationships = Vec::new();
    for first_index in 0..roads.len() {
        for second_index in (first_index + 1)..roads.len() {
            let Some(first_id) = roads[first_index].as_i64() else {
                continue;
            };
            let Some(second_id) = roads[second_index].as_i64() else {
                continue;
            };
            let Some(first) = road_structures.get(&first_id) else {
                continue;
            };
            let Some(second) = road_structures.get(&second_id) else {
                continue;
            };
            let kind = match classify_road_relationship(CrossingCandidate {
                shared_node_ids: shared_node_ids.clone(),
                first: *first,
                second: *second,
            }) {
                RoadRelationship::ConnectedAtNode { .. } => "connected-at-node",
                RoadRelationship::GradeSeparated { .. } => "grade-separated",
                RoadRelationship::Unresolved { .. } => "unresolved",
            };
            relationships.push(json!({
                "roadIds": [first_id, second_id],
                "kind": kind,
                "sourceNodeIds": shared_node_ids.clone(),
            }));
        }
    }
    relationships
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
            let road_entry = entry.as_array()?;
            let road = road_entry.get(1)?;
            Some((numeric_id(road_entry.first()?)?, road["osm_ids"].clone()))
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
        match geometry.value {
            GeoJsonValue::Polygon(rings) => {
                for ring in rings {
                    let local_geometry = ring
                        .iter()
                        .cloned()
                        .map(|point| local_point(point, bounds))
                        .collect::<Vec<_>>();
                    let source_way_ids = road_id
                        .and_then(|id| source_ids.get(&id).cloned())
                        .unwrap_or_else(|| source_way_ids_near_geometry(&local_geometry, roads));
                    output.push(json!({
                        "type": kind,
                        "layer": feature.property("layer").and_then(Value::as_i64),
                        "sourceWayIds": source_way_ids,
                        "geometry": local_geometry,
                    }));
                }
            }
            GeoJsonValue::MultiPolygon(polygons) => {
                for polygon in polygons {
                    for ring in polygon {
                        let local_geometry = ring
                            .iter()
                            .cloned()
                            .map(|point| local_point(point, bounds))
                            .collect::<Vec<_>>();
                        let source_way_ids = road_id
                            .and_then(|id| source_ids.get(&id).cloned())
                            .unwrap_or_else(|| source_way_ids_near_geometry(&local_geometry, roads));
                        output.push(json!({
                            "type": kind,
                            "layer": feature.property("layer").and_then(Value::as_i64),
                            "sourceWayIds": source_way_ids,
                            "geometry": local_geometry,
                        }));
                    }
                }
            }
            _ => {}
        }
    }
    Ok(output)
}

fn source_way_ids_near_geometry(geometry: &[[f64; 2]], roads: &Value) -> Value {
    let Some(center) = centroid(geometry) else {
        return json!([]);
    };
    let mut nearest: Option<(f64, Value)> = None;
    for entry in roads.as_array().into_iter().flatten() {
        let Some(road) = entry.as_array().and_then(|entry| entry.get(1)) else {
            continue;
        };
        let center_line = points(&road["center_line"]["pts"]);
        let Some(distance) = distance_to_polyline(center, &center_line) else {
            continue;
        };
        if nearest.as_ref().is_none_or(|(best, _)| distance < *best) {
            nearest = Some((distance, road["osm_ids"].clone()));
        }
    }
    nearest
        .filter(|(distance, _)| *distance <= 500.0)
        .map(|(_, source_way_ids)| source_way_ids)
        .unwrap_or_else(|| json!([]))
}

fn centroid(points: &[[f64; 2]]) -> Option<[f64; 2]> {
    if points.is_empty() {
        return None;
    }
    let (x, y) = points
        .iter()
        .fold((0.0, 0.0), |(x, y), point| (x + point[0], y + point[1]));
    Some([x / points.len() as f64, y / points.len() as f64])
}

fn distance_to_polyline(point: [f64; 2], line: &[[f64; 2]]) -> Option<f64> {
    line.windows(2)
        .map(|segment| distance_to_segment(point, segment[0], segment[1]))
        .min_by(f64::total_cmp)
}

fn distance_to_segment(point: [f64; 2], start: [f64; 2], end: [f64; 2]) -> f64 {
    let vector = [end[0] - start[0], end[1] - start[1]];
    let length_squared = vector[0].mul_add(vector[0], vector[1] * vector[1]);
    let ratio = if length_squared <= f64::EPSILON {
        0.0
    } else {
        ((point[0] - start[0]) * vector[0] + (point[1] - start[1]) * vector[1])
            / length_squared
    }
    .clamp(0.0, 1.0);
    let closest = [start[0] + vector[0] * ratio, start[1] + vector[1] * ratio];
    (point[0] - closest[0]).hypot(point[1] - closest[1])
}

fn numeric_id(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.get("0").and_then(Value::as_i64))
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

/// osm2streets' own marking renderer has no concept of a pavement edge line,
/// only inter-lane markings, so the fog line boundary is derived here from
/// the same left-to-right lane widths it already exposes.
fn shoulder_widths_feet(lane_specs_ltr: &Value) -> (Option<f64>, Option<f64>) {
    let lanes: Vec<&Value> = lane_specs_ltr.as_array().into_iter().flatten().collect();
    let left = lanes
        .first()
        .filter(|lane| lane["lt"] == "Shoulder")
        .map(|lane| serialized_distance_to_feet(&lane["width"]));
    let right = lanes
        .last()
        .filter(|lane| lane["lt"] == "Shoulder")
        .map(|lane| serialized_distance_to_feet(&lane["width"]));
    (left, right)
}

/// Distance a fog line is pulled back from a ramp/acceleration/deceleration
/// gore connection so the line breaks instead of running through the merge.
const GORE_BREAK_FEET: f64 = 70.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FogLineSide {
    Left,
    Right,
}

fn is_ramp_highway(highway: &str) -> bool {
    highway.ends_with("_link")
}

/// For every road endpoint that shares a normalized intersection with a ramp
/// (or is itself a ramp joining another road), determines which fog line
/// side faces that connection so it can be broken there instead of drawn
/// straight through the gore.
fn gore_fog_line_breaks(
    roads: &Value,
    intersections: &Value,
) -> HashMap<i64, (Option<FogLineSide>, Option<FogLineSide>)> {
    let mut road_highway = HashMap::new();
    let mut road_center_line = HashMap::new();
    let mut road_endpoints = HashMap::new();
    for entry in roads.as_array().into_iter().flatten() {
        let Some(id) = entry.get(0).and_then(Value::as_i64) else {
            continue;
        };
        let Some(road) = entry.get(1) else { continue };
        road_highway.insert(
            id,
            road["highway_type"].as_str().unwrap_or_default().to_string(),
        );
        road_center_line.insert(id, points(&road["center_line"]["pts"]));
        if let (Some(src), Some(dst)) = (road["src_i"].as_i64(), road["dst_i"].as_i64()) {
            road_endpoints.insert(id, (src, dst));
        }
    }

    let mut intersection_roads = HashMap::new();
    for entry in intersections.as_array().into_iter().flatten() {
        let Some(id) = entry.get(0).and_then(Value::as_i64) else {
            continue;
        };
        let Some(intersection) = entry.get(1) else {
            continue;
        };
        let connected: Vec<i64> = intersection["roads"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_i64)
            .collect();
        intersection_roads.insert(id, connected);
    }

    let mut breaks: HashMap<i64, (Option<FogLineSide>, Option<FogLineSide>)> = HashMap::new();
    for (&road_id, &(src_id, dst_id)) in &road_endpoints {
        let Some(center_line) = road_center_line.get(&road_id) else {
            continue;
        };
        let this_highway = road_highway.get(&road_id).map(String::as_str).unwrap_or("");
        for (is_start, intersection_id) in [(true, src_id), (false, dst_id)] {
            let Some(siblings) = intersection_roads.get(&intersection_id) else {
                continue;
            };
            let ramp_sibling = siblings.iter().copied().find(|&sibling_id| {
                sibling_id != road_id
                    && (is_ramp_highway(this_highway)
                        || road_highway
                            .get(&sibling_id)
                            .is_some_and(|highway| is_ramp_highway(highway)))
            });
            let Some(sibling_id) = ramp_sibling else {
                continue;
            };
            let Some(sibling_line) = road_center_line.get(&sibling_id) else {
                continue;
            };
            let Some(side) = fog_line_break_side(center_line, is_start, sibling_line) else {
                continue;
            };
            let entry = breaks.entry(road_id).or_insert((None, None));
            if is_start {
                entry.0 = Some(side);
            } else {
                entry.1 = Some(side);
            }
        }
    }
    breaks
}

/// The near-side rule: a shared node sits on both roads' centerlines, so the
/// break side is whichever side of this road's own forward tangent the
/// sibling road's tangent leaves toward (matching `ribbon`'s left-normal
/// convention: `(-dy, dx)` is left).
fn fog_line_break_side(
    this_line: &[[f64; 2]],
    is_start: bool,
    sibling_line: &[[f64; 2]],
) -> Option<FogLineSide> {
    // Always the forward direction in increasing-index order, matching
    // `offset_polyline`'s left/right convention at either end of the road.
    let this_tangent = if is_start {
        tangent(this_line.first().copied()?, this_line.get(1).copied()?)
    } else {
        let last = this_line.len().checked_sub(1)?;
        tangent(this_line.get(last.checked_sub(1)?).copied()?, this_line[last])
    };
    let shared_point = if is_start {
        this_line.first().copied()?
    } else {
        this_line.last().copied()?
    };
    let sibling_other_end = nearest_far_endpoint(sibling_line, shared_point)?;
    let sibling_tangent = tangent(shared_point, sibling_other_end);
    let left_normal = [-this_tangent[1], this_tangent[0]];
    let side_value = sibling_tangent[0] * left_normal[0] + sibling_tangent[1] * left_normal[1];
    if side_value.abs() <= 1e-6 {
        return None;
    }
    Some(if side_value > 0.0 {
        FogLineSide::Left
    } else {
        FogLineSide::Right
    })
}

fn nearest_far_endpoint(line: &[[f64; 2]], shared_point: [f64; 2]) -> Option<[f64; 2]> {
    let first = *line.first()?;
    let last = *line.last()?;
    let distance_to_first = (first[0] - shared_point[0]).hypot(first[1] - shared_point[1]);
    let distance_to_last = (last[0] - shared_point[0]).hypot(last[1] - shared_point[1]);
    Some(if distance_to_first <= distance_to_last {
        last
    } else {
        first
    })
}

fn tangent(from: [f64; 2], to: [f64; 2]) -> [f64; 2] {
    let delta = [to[0] - from[0], to[1] - from[1]];
    let length = delta[0].hypot(delta[1]);
    if length <= 1e-9 {
        [0.0, 0.0]
    } else {
        [delta[0] / length, delta[1] / length]
    }
}

/// Removes the last `distance` feet of the polyline, walking in from
/// whichever end `from_start` names, so the returned line stops short of a
/// gore connection instead of running through it.
fn truncate_polyline(points: &[[f64; 2]], distance: f64, from_start: bool) -> Vec<[f64; 2]> {
    if points.len() < 2 || distance <= 0.0 {
        return points.to_vec();
    }
    let mut ordered = points.to_vec();
    if !from_start {
        ordered.reverse();
    }
    let mut remaining = distance;
    let mut result = Vec::with_capacity(ordered.len());
    for index in 0..ordered.len() - 1 {
        let start = ordered[index];
        let end = ordered[index + 1];
        let segment_length = (end[0] - start[0]).hypot(end[1] - start[1]);
        if remaining >= segment_length {
            remaining -= segment_length;
            continue;
        }
        let ratio = if segment_length <= 1e-9 {
            0.0
        } else {
            remaining / segment_length
        };
        result.push([
            start[0] + (end[0] - start[0]) * ratio,
            start[1] + (end[1] - start[1]) * ratio,
        ]);
        result.extend_from_slice(&ordered[index + 1..]);
        break;
    }
    if !from_start {
        result.reverse();
    }
    result
}

/// Offsets `points` perpendicular to the path by `offset` feet using the same
/// left-positive convention as `ribbon`: positive offsets shift left.
fn offset_polyline(points: &[[f64; 2]], offset: f64) -> Vec<[f64; 2]> {
    points
        .iter()
        .enumerate()
        .map(|(index, point)| {
            let previous = points[index.saturating_sub(1)];
            let next = points[(index + 1).min(points.len() - 1)];
            let delta = [next[0] - previous[0], next[1] - previous[1]];
            let length = delta[0].hypot(delta[1]);
            let normal = if length <= 1e-9 {
                [0.0, 0.0]
            } else {
                [-delta[1] / length * offset, delta[0] / length * offset]
            };
            [point[0] + normal[0], point[1] + normal[1]]
        })
        .collect()
}

fn fog_line_markings_for_road(
    source_way_ids: &Value,
    layer: i16,
    center_line: &[[f64; 2]],
    width_feet: f64,
    left_shoulder_feet: Option<f64>,
    right_shoulder_feet: Option<f64>,
    start_break: Option<FogLineSide>,
    end_break: Option<FogLineSide>,
) -> Vec<Value> {
    if center_line.len() < 2 || width_feet <= 0.0 {
        return Vec::new();
    }
    let half_width = width_feet / 2.0;
    let mut markings = Vec::new();
    let left_offset = half_width - left_shoulder_feet.unwrap_or(0.0);
    if left_offset > 0.0 {
        let line = broken_center_line(center_line, FogLineSide::Left, start_break, end_break);
        if line.len() >= 2 {
            markings.push(json!({
                "type": "left fog line",
                "sourceWayIds": source_way_ids,
                "layer": layer,
                "geometryType": "LineString",
                "geometry": offset_polyline(&line, left_offset),
            }));
        }
    }
    let right_offset = half_width - right_shoulder_feet.unwrap_or(0.0);
    if right_offset > 0.0 {
        let line = broken_center_line(center_line, FogLineSide::Right, start_break, end_break);
        if line.len() >= 2 {
            markings.push(json!({
                "type": "right fog line",
                "sourceWayIds": source_way_ids,
                "layer": layer,
                "geometryType": "LineString",
                "geometry": offset_polyline(&line, -right_offset),
            }));
        }
    }
    markings
}

/// Truncates the centerline used to derive one fog line so it stops short of
/// a ramp/acceleration/deceleration gore instead of running through it.
fn broken_center_line(
    center_line: &[[f64; 2]],
    side: FogLineSide,
    start_break: Option<FogLineSide>,
    end_break: Option<FogLineSide>,
) -> Vec<[f64; 2]> {
    let mut line = center_line.to_vec();
    if start_break == Some(side) {
        line = truncate_polyline(&line, GORE_BREAK_FEET, true);
    }
    if end_break == Some(side) {
        line = truncate_polyline(&line, GORE_BREAK_FEET, false);
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_crossing_point_for_perpendicular_segments() {
        assert_eq!(
            line_crossing_point(&[[0.0, 0.0], [10.0, 0.0]], &[[5.0, -4.0], [5.0, 4.0]]),
            Some([5.0, 0.0])
        );
    }

    #[test]
    fn ignores_parallel_segments() {
        assert_eq!(
            line_crossing_point(&[[0.0, 0.0], [10.0, 0.0]], &[[0.0, 5.0], [10.0, 5.0]]),
            None
        );
    }

    #[test]
    fn recognizes_shared_normalized_endpoints() {
        let first = json!({"src_i": 1, "dst_i": 2});
        let second = json!({"src_i": 2, "dst_i": 3});

        assert!(share_normalized_endpoint(&first, &second));
    }

    #[test]
    fn keeps_unshared_normalized_endpoints_distinct() {
        let first = json!({"src_i": 1, "dst_i": 2});
        let second = json!({"src_i": 3, "dst_i": 4});

        assert!(!share_normalized_endpoint(&first, &second));
    }

    #[test]
    fn truncates_the_start_of_a_polyline_by_the_requested_distance() {
        let line = truncate_polyline(&[[0.0, 0.0], [100.0, 0.0]], 30.0, true);
        assert_eq!(line, vec![[30.0, 0.0], [100.0, 0.0]]);
    }

    #[test]
    fn truncates_the_end_of_a_polyline_by_the_requested_distance() {
        let line = truncate_polyline(&[[0.0, 0.0], [100.0, 0.0]], 30.0, false);
        assert_eq!(line, vec![[0.0, 0.0], [70.0, 0.0]]);
    }

    #[test]
    fn empties_a_polyline_shorter_than_the_requested_truncation() {
        let line = truncate_polyline(&[[0.0, 0.0], [10.0, 0.0]], 30.0, true);
        assert!(line.is_empty());
    }

    #[test]
    fn finds_the_gore_break_side_for_a_ramp_diverging_toward_positive_y() {
        // Mainline runs straight along +x; left/right follow the same
        // (-dy, dx) forward-tangent convention as `offset_polyline`.
        let mainline = [[0.0, 0.0], [100.0, 0.0]];
        let ramp = [[100.0, 0.0], [140.0, 40.0]];
        assert_eq!(
            fog_line_break_side(&mainline, false, &ramp),
            Some(FogLineSide::Left)
        );
    }

    #[test]
    fn finds_the_gore_break_side_for_a_ramp_diverging_toward_negative_y() {
        let mainline = [[0.0, 0.0], [100.0, 0.0]];
        let ramp = [[100.0, 0.0], [140.0, -40.0]];
        assert_eq!(
            fog_line_break_side(&mainline, false, &ramp),
            Some(FogLineSide::Right)
        );
    }
}

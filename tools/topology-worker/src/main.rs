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
    let markings = semantic_markings(&markings, &streets.gps_bounds, &serialized["roads"])?;
    Ok(json!({
        "version": 1,
        "coordinateUnits": "feet",
        "roads": roads,
        "intersections": intersections,
        "markings": markings,
        "diagnostics": diagnostics,
    }))
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
}

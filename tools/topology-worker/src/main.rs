use std::{
    collections::{BTreeMap, HashMap, VecDeque},
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
use geom::{Distance, GPSBounds, LonLat, PolyLine};
use magnus_spatial_core::topology::{
    classify_road_relationship, CrossingCandidate, RoadRelationship, RoadStructure,
};
use osm2streets::{
    osm::WayID, Direction, Filter, LaneSpec, LaneType, StreetNetwork, Transformation,
};
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
    let gore_breaks = gore_fog_line_breaks(&serialized["roads"], serialized_intersections);
    let merge_lane_sides = merge_lane_sides(
        &serialized["roads"],
        serialized_intersections,
        &gore_breaks,
        osm_tags,
    );
    let road_geometry = road_geometry(streets);
    let roads = serialized["roads"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.as_array()?.get(1))
        .map(|road| {
            let geometry = road["id"].as_i64().and_then(|id| road_geometry.get(&id));
            let center_line = geometry.map(|g| g.center_line.clone()).unwrap_or_default();
            let surface_polygon = geometry.map(|g| g.surface_polygon.clone()).unwrap_or_default();
            let width_feet = geometry.map_or(0.0, |g| g.width_feet);
            let (bridge, tunnel) = structural_tags(&road["osm_ids"], osm_tags);
            let highway = road["highway_type"].as_str().unwrap_or_default();
            let merge_lane_side = road["id"]
                .as_i64()
                .and_then(|id| merge_lane_sides.get(&id).copied());
            let merge_lane_zone = merge_lane_zone(highway, &center_line, merge_lane_side);
            json!({
                "topologyRoadId": road["id"],
                "sourceWayIds": road["osm_ids"],
                "endpointNodeIds": source_endpoint_node_ids(road, serialized_intersections),
                "layer": road["layer"],
                "highway": highway,
                "laneCount": road["lane_specs_ltr"].as_array().map_or(1, Vec::len),
                "laneRecords": lane_records(&road["lane_specs_ltr"]),
                "auxiliaryLaneSide": merge_lane_zone.as_ref().map(|zone| zone.side),
                "mergeLaneZone": merge_lane_zone.map(|zone| json!({
                    "side": zone.side,
                    "geometrySide": zone.geometry_side,
                    "startArcFeet": zone.start_arc_feet,
                    "endArcFeet": zone.end_arc_feet,
                })),
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
    // Boundary positions are re-emitted as LineStrings below, so drop the
    // upstream pre-dashed polygon rendering of the same lines.
    markings.retain(|marking| {
        !matches!(
            marking["type"].as_str(),
            Some("center line") | Some("lane separator")
        )
    });
    markings.extend(boundary_markings(streets, &gore_breaks, &merge_lane_sides));
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

fn intersection_layer(intersection: &Value, road_structures: &HashMap<i64, RoadStructure>) -> i16 {
    intersection["roads"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_i64)
        .filter_map(|road_id| {
            road_structures
                .get(&road_id)
                .map(|structure| structure.layer)
        })
        .min()
        .map_or(-1, |layer| layer.saturating_sub(1))
}

struct RoadGeometry {
    center_line: Vec<[f64; 2]>,
    surface_polygon: Vec<[f64; 2]>,
    width_feet: f64,
}

/// Trimmed centerline and pavement for each road, both built with osm2streets'
/// own `make_polygons` so nothing downstream has to rebuild the geometry.
fn road_geometry(streets: &StreetNetwork) -> HashMap<i64, RoadGeometry> {
    streets
        .roads
        .iter()
        .map(|(id, road)| {
            let total_width = road.total_width();
            let surface_polygon = road
                .center_line
                .make_polygons(total_width)
                .get_outer_ring()
                .points()
                .iter()
                .map(|point| [point.x() * METERS_TO_FEET, point.y() * METERS_TO_FEET])
                .collect();
            (
                id.0 as i64,
                RoadGeometry {
                    center_line: feet_points(&road.center_line),
                    surface_polygon,
                    width_feet: total_width.inner_meters() * METERS_TO_FEET,
                },
            )
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
                            .unwrap_or_else(|| {
                                source_way_ids_near_geometry(&local_geometry, roads)
                            });
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
        ((point[0] - start[0]) * vector[0] + (point[1] - start[1]) * vector[1]) / length_squared
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

fn serialized_distance_to_feet(value: &Value) -> f64 {
    value.as_f64().unwrap_or(0.0) / 10_000.0 * 3.280_839_895
}

const METERS_TO_FEET: f64 = 3.280_839_895;

fn feet_points(line: &PolyLine) -> Vec<[f64; 2]> {
    line.points()
        .iter()
        .map(|point| [point.x() * METERS_TO_FEET, point.y() * METERS_TO_FEET])
        .collect()
}

/// Every roadway boundary is the cumulative lane width from the road's left
/// edge, offset with osm2streets' own mitered `shift_from_center`.
///
/// osm2streets computes the same separator positions internally, but
/// `to_lane_markings_geojson` only emits them as pre-dashed metric polygons and
/// has no pavement-edge concept at all. Magnus needs continuous LineStrings it
/// can style with VDOT dash cycles, so the boundaries are re-emitted here using
/// the upstream offset primitive rather than a hand-rolled normal offset.
fn boundary_markings(
    streets: &StreetNetwork,
    gore_breaks: &HashMap<i64, (Option<FogLineSide>, Option<FogLineSide>)>,
    merge_lane_sides: &HashMap<i64, MergeLaneSides>,
) -> Vec<Value> {
    let mut markings = Vec::new();
    for (id, road) in &streets.roads {
        let road_id = id.0 as i64;
        let lanes = &road.lane_specs_ltr;
        // A single-lane road has no interior separator but still has two edges.
        if lanes.is_empty() {
            continue;
        }
        let total_width = road.total_width();
        let (start_break, end_break) = gore_breaks.get(&road_id).copied().unwrap_or((None, None));
        let source_way_ids = road.osm_ids.iter().map(|way| way.0).collect::<Vec<_>>();

        let separators = lanes
            .windows(2)
            .enumerate()
            .filter(|(_, pair)| is_lane_separator(&pair[0], &pair[1]))
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        // The merge lane is the outermost driving lane on the ramp side. Which
        // side that is comes from where the ramp physically lies, since the
        // tag- and gore-derived sides disagree with it often enough to put the
        // lane on the wrong side of the road.
        let auxiliary_separator = merge_lane_sides
            .get(&road_id)
            .and_then(|sides| {
                ramp_side(streets, road).or_else(|| match sides.geometry_side {
                    "left" => Some(FogLineSide::Left),
                    _ => Some(FogLineSide::Right),
                })
            })
            .and_then(|side| match side {
                FogLineSide::Left => separators.first().copied(),
                FogLineSide::Right => separators.last().copied(),
            });

        let mut width_from_left = Distance::ZERO;
        for (index, pair) in lanes.windows(2).enumerate() {
            width_from_left += pair[0].width;
            let Some(marking_type) =
                separator_marking(&pair[0], &pair[1], Some(index) == auxiliary_separator)
            else {
                continue;
            };
            let Ok(line) = road
                .center_line
                .shift_from_center(total_width, width_from_left)
            else {
                continue;
            };
            markings.push(json!({
                "type": marking_type,
                "topologyRoadId": road_id,
                "sourceWayIds": source_way_ids,
                "layer": road.layer,
                "geometryType": "LineString",
                "geometry": feet_points(&line),
            }));
        }

        for (side, offset) in traveled_way_edges(lanes) {
            let Ok(line) = road.center_line.shift_from_center(total_width, offset) else {
                continue;
            };
            let Some(line) = break_at_gore(line, side, start_break, end_break) else {
                continue;
            };
            markings.push(json!({
                "type": edge_marking_name(lanes, side),
                "topologyRoadId": road_id,
                "sourceWayIds": source_way_ids,
                "layer": road.layer,
                "geometryType": "LineString",
                "geometry": feet_points(&line),
            }));
        }
    }
    markings
}

/// Offsets of the outer edges of the traveled way, measured from the road's
/// left edge. A shoulder puts the edge line inside the pavement; without one it
/// falls on the pavement edge itself.
fn traveled_way_edges(lanes: &[LaneSpec]) -> Vec<(FogLineSide, Distance)> {
    let Some(first) = lanes.iter().position(|lane| lane.lt == LaneType::Driving) else {
        return Vec::new();
    };
    let Some(last) = lanes.iter().rposition(|lane| lane.lt == LaneType::Driving) else {
        return Vec::new();
    };
    let width_through = |count: usize| {
        lanes
            .iter()
            .take(count)
            .fold(Distance::ZERO, |total, lane| total + lane.width)
    };
    vec![
        (FogLineSide::Left, width_through(first)),
        (FogLineSide::Right, width_through(last + 1)),
    ]
}

fn is_lane_separator(left: &LaneSpec, right: &LaneSpec) -> bool {
    left.lt == LaneType::Driving && right.lt == LaneType::Driving && left.dir == right.dir
}

/// Which side of a road, in its own left-to-right lane order, the ramps
/// connected to it actually lie on.
///
/// The side is calibrated against `shift_from_center` itself rather than a
/// hand-derived cross-product convention, so it cannot drift out of step with
/// the offsets used to place the markings.
fn ramp_side(streets: &StreetNetwork, road: &osm2streets::Road) -> Option<FogLineSide> {
    let width = road.total_width();
    if width <= Distance::ZERO {
        return None;
    }
    let centre = road.center_line.middle();
    let left_edge = road
        .center_line
        .shift_from_center(width, Distance::ZERO)
        .ok()?
        .middle();
    let towards_left = (left_edge.x() - centre.x(), left_edge.y() - centre.y());

    let mut best: Option<(f64, FogLineSide)> = None;
    for end in [road.src_i, road.dst_i] {
        let Some(intersection) = streets.intersections.get(&end) else {
            continue;
        };
        for other in &intersection.roads {
            let Some(ramp) = streets.roads.get(other) else {
                continue;
            };
            if *other == road.id || !ramp.highway_type.ends_with("_link") {
                continue;
            }
            let point = ramp.center_line.middle();
            let offset = (point.x() - centre.x(), point.y() - centre.y());
            let projection = offset.0 * towards_left.0 + offset.1 * towards_left.1;
            if best.as_ref().is_none_or(|(best, _)| projection.abs() > *best) {
                best = Some((
                    projection.abs(),
                    if projection > 0.0 {
                        FogLineSide::Left
                    } else {
                        FogLineSide::Right
                    },
                ));
            }
        }
    }
    best.map(|(_, side)| side)
}

/// Edge line colour is traffic-relative, not geometry-relative: yellow marks a
/// driver's left, white a driver's right. `lane_specs_ltr` is ordered along the
/// centreline, so a carriageway digitised against its traffic has its sides
/// swapped, and an undivided two-way road is white on *both* outer edges
/// because each one is some driver's right.
fn edge_marking_name(lanes: &[LaneSpec], side: FogLineSide) -> &'static str {
    let mut directions = lanes
        .iter()
        .filter(|lane| lane.lt == LaneType::Driving)
        .map(|lane| lane.dir);
    let Some(first) = directions.next() else {
        return "right fog line";
    };
    if directions.any(|direction| direction != first) {
        return "right fog line";
    }
    let drivers_left = match (side, first) {
        (FogLineSide::Left, Direction::Forward) | (FogLineSide::Right, Direction::Backward) => true,
        _ => false,
    };
    if drivers_left {
        "left fog line"
    } else {
        "right fog line"
    }
}

/// Names the interior boundary between two adjacent lanes.
fn separator_marking(
    left: &LaneSpec,
    right: &LaneSpec,
    is_auxiliary: bool,
) -> Option<&'static str> {
    if left.lt != LaneType::Driving || right.lt != LaneType::Driving {
        return None;
    }
    if left.dir != right.dir {
        return Some("center line");
    }
    Some(if is_auxiliary {
        "auxiliary lane separator"
    } else {
        "lane separator"
    })
}

/// A ramp or acceleration/deceleration connection must break the fog line where
/// it connects instead of drawing straight through the gore.
fn break_at_gore(
    line: PolyLine,
    side: FogLineSide,
    start_break: Option<FogLineSide>,
    end_break: Option<FogLineSide>,
) -> Option<PolyLine> {
    let breaks_start = start_break == Some(side);
    let breaks_end = end_break == Some(side);
    if !breaks_start && !breaks_end {
        return Some(line);
    }
    let cut = Distance::feet(GORE_BREAK_FEET);
    let start = if breaks_start { cut } else { Distance::ZERO };
    let end = if breaks_end {
        line.length() - cut
    } else {
        line.length()
    };
    if end <= start {
        return None;
    }
    line.maybe_exact_slice(start, end).ok()
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

#[derive(Debug, Clone, Copy, PartialEq)]
struct MergeLaneZone {
    side: &'static str,
    geometry_side: &'static str,
    start_arc_feet: f64,
    end_arc_feet: f64,
}

#[derive(Debug, Clone, Copy)]
struct MergeLaneSides {
    traffic_side: &'static str,
    geometry_side: &'static str,
}

fn merge_lane_zone(
    highway: &str,
    center_line: &[[f64; 2]],
    sides: Option<MergeLaneSides>,
) -> Option<MergeLaneZone> {
    if is_ramp_highway(highway) || center_line.len() < 2 {
        return None;
    }
    let sides = sides?;
    Some(MergeLaneZone {
        side: sides.traffic_side,
        geometry_side: sides.geometry_side,
        start_arc_feet: 0.0,
        end_arc_feet: polyline_length_feet(center_line),
    })
}

fn merge_lane_sides(
    roads: &Value,
    intersections: &Value,
    gore_breaks: &HashMap<i64, (Option<FogLineSide>, Option<FogLineSide>)>,
    osm_tags: &BTreeMap<WayID, Tags>,
) -> HashMap<i64, MergeLaneSides> {
    let road_by_id = roads
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| Some((entry.get(0)?.as_i64()?, entry.get(1)?)))
        .collect::<HashMap<_, _>>();
    let mut sides = HashMap::new();
    let mut pending = VecDeque::new();

    for (&road_id, road) in &road_by_id {
        if !has_narrower_mainline_neighbor(road, roads, intersections) {
            continue;
        }
        let (start_break, end_break) = gore_breaks.get(&road_id).copied().unwrap_or((None, None));
        let geometry_side = auxiliary_lane_side(start_break, end_break);
        let traffic_side =
            auxiliary_lane_side_from_tags(&road["osm_ids"], osm_tags).or(geometry_side);
        let geometry_side = geometry_side.or_else(|| {
            traffic_side.map(|side| {
                if geometry_runs_with_traffic(&road["lane_specs_ltr"]) {
                    side
                } else {
                    opposite_lane_side(side)
                }
            })
        });
        if let (Some(traffic_side), Some(geometry_side)) = (traffic_side, geometry_side) {
            sides.insert(
                road_id,
                MergeLaneSides {
                    traffic_side,
                    geometry_side,
                },
            );
            pending.push_back(road_id);
        }
    }

    while let Some(road_id) = pending.pop_front() {
        let Some(&lane_sides) = sides.get(&road_id) else {
            continue;
        };
        let Some(road) = road_by_id.get(&road_id).copied() else {
            continue;
        };
        for sibling_id in connected_road_ids(road, intersections) {
            if sides.contains_key(&sibling_id) {
                continue;
            }
            let Some(sibling) = road_by_id.get(&sibling_id).copied() else {
                continue;
            };
            if compatible_widened_mainline_fragments(road, sibling)
                && auxiliary_lane_side_from_tags(&sibling["osm_ids"], osm_tags).is_none()
            {
                sides.insert(sibling_id, lane_sides);
                pending.push_back(sibling_id);
            }
        }
    }
    sides
}

fn connected_road_ids(road: &Value, intersections: &Value) -> Vec<i64> {
    ["src_i", "dst_i"]
        .into_iter()
        .filter_map(|endpoint| road[endpoint].as_i64())
        .flat_map(|intersection_id| {
            intersections
                .as_array()
                .into_iter()
                .flatten()
                .find(|entry| entry.get(0).and_then(Value::as_i64) == Some(intersection_id))
                .and_then(|entry| entry.get(1))
                .and_then(|intersection| intersection["roads"].as_array())
                .into_iter()
                .flatten()
                .filter_map(Value::as_i64)
                .collect::<Vec<_>>()
        })
        .collect()
}

fn compatible_widened_mainline_fragments(first: &Value, second: &Value) -> bool {
    let highway = first["highway_type"].as_str().unwrap_or_default();
    !is_ramp_highway(highway)
        && second["highway_type"].as_str() == Some(highway)
        && first["layer"] == second["layer"]
        && driving_lane_count(first) == driving_lane_count(second)
        && driving_lane_count(first) > 0
}

fn auxiliary_lane_side(
    start_break: Option<FogLineSide>,
    end_break: Option<FogLineSide>,
) -> Option<&'static str> {
    if start_break != end_break {
        return None;
    }
    match start_break {
        Some(FogLineSide::Left) => Some("left"),
        Some(FogLineSide::Right) => Some("right"),
        None => None,
    }
}

/// True when the serialized lane order runs along the direction of travel, so a
/// traffic-relative side and a geometry-relative side mean the same thing.
fn geometry_runs_with_traffic(lane_specs_ltr: &Value) -> bool {
    lane_specs_ltr
        .as_array()
        .into_iter()
        .flatten()
        .filter(|lane| lane["lt"] == "Driving")
        .find_map(|lane| lane["dir"].as_str())
        .is_none_or(|direction| direction == "Forward")
}

fn opposite_lane_side(side: &str) -> &'static str {
    match side {
        "left" => "right",
        _ => "left",
    }
}

fn auxiliary_lane_side_from_tags(
    source_way_ids: &Value,
    osm_tags: &BTreeMap<WayID, Tags>,
) -> Option<&'static str> {
    source_way_ids
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_i64)
        .filter_map(|way_id| osm_tags.get(&WayID(way_id)))
        .filter_map(|tags| {
            tags.get("turn:lanes")
                .or_else(|| tags.get("turn:lanes:forward"))
        })
        .find_map(|turn_lanes| lane_side_from_turn_lanes(turn_lanes))
}

fn lane_side_from_turn_lanes(turn_lanes: &str) -> Option<&'static str> {
    let lanes = turn_lanes.split('|').collect::<Vec<_>>();
    let leftmost = lanes.first()?.to_ascii_lowercase();
    let rightmost = lanes.last()?.to_ascii_lowercase();
    if !rightmost.is_empty() && (rightmost.contains("right") || rightmost.contains("merge_to_left"))
    {
        return Some("right");
    }
    if !leftmost.is_empty() && (leftmost.contains("left") || leftmost.contains("merge_to_right")) {
        return Some("left");
    }
    None
}

fn has_narrower_mainline_neighbor(road: &Value, roads: &Value, intersections: &Value) -> bool {
    let this_driving_lanes = driving_lane_count(road);
    let this_highway = road["highway_type"].as_str().unwrap_or_default();
    if this_driving_lanes == 0 || is_ramp_highway(this_highway) {
        return false;
    }
    let road_by_id = roads
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| Some((entry.get(0)?.as_i64()?, entry.get(1)?)))
        .collect::<HashMap<_, _>>();
    ["src_i", "dst_i"].into_iter().any(|endpoint| {
        let Some(intersection_id) = road[endpoint].as_i64() else {
            return false;
        };
        intersections
            .as_array()
            .into_iter()
            .flatten()
            .find(|entry| entry.get(0).and_then(Value::as_i64) == Some(intersection_id))
            .and_then(|entry| entry.get(1))
            .and_then(|intersection| intersection["roads"].as_array())
            .into_iter()
            .flatten()
            .filter_map(Value::as_i64)
            .filter_map(|sibling_id| road_by_id.get(&sibling_id).copied())
            .any(|sibling| {
                sibling["highway_type"].as_str() == Some(this_highway)
                    && !is_ramp_highway(this_highway)
                    && driving_lane_count(sibling) < this_driving_lanes
            })
    })
}

fn driving_lane_count(road: &Value) -> usize {
    road["lane_specs_ltr"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|lane| lane["lt"] == "Driving")
        .count()
}

fn polyline_length_feet(points: &[[f64; 2]]) -> f64 {
    points
        .windows(2)
        .map(|segment| (segment[1][0] - segment[0][0]).hypot(segment[1][1] - segment[0][1]))
        .sum()
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
            road["highway_type"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
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
        tangent(
            this_line.get(last.checked_sub(1)?).copied()?,
            this_line[last],
        )
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

#[cfg(test)]
mod tests {
    use super::*;
    use geom::Pt2D;
    use osm2streets::Direction;

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
    fn breaks_a_fog_line_back_from_a_gore_at_the_start() {
        let line = PolyLine::must_new(vec![Pt2D::new(0.0, 0.0), Pt2D::new(100.0, 0.0)]);
        let broken = break_at_gore(line, FogLineSide::Left, Some(FogLineSide::Left), None)
            .expect("a 100 m line outlasts a 70 ft break");

        let break_meters = Distance::feet(GORE_BREAK_FEET).inner_meters();
        assert!((broken.first_pt().x() - break_meters).abs() < 0.01);
        assert!((broken.length().inner_meters() - (100.0 - break_meters)).abs() < 0.01);
    }

    #[test]
    fn leaves_a_fog_line_whole_when_the_gore_faces_the_other_side() {
        let line = PolyLine::must_new(vec![Pt2D::new(0.0, 0.0), Pt2D::new(100.0, 0.0)]);
        let kept = break_at_gore(line, FogLineSide::Left, Some(FogLineSide::Right), None)
            .expect("an unaffected fog line survives");

        assert!((kept.length().inner_meters() - 100.0).abs() < 0.01);
    }

    #[test]
    fn drops_a_fog_line_shorter_than_the_gore_break() {
        let line = PolyLine::must_new(vec![Pt2D::new(0.0, 0.0), Pt2D::new(10.0, 0.0)]);

        assert!(break_at_gore(line, FogLineSide::Left, Some(FogLineSide::Left), None).is_none());
    }

    #[test]
    fn names_each_interior_boundary_from_the_lanes_it_separates() {
        let shoulder = test_lane(LaneType::Shoulder, Direction::Forward);
        let forward = test_lane(LaneType::Driving, Direction::Forward);
        let backward = test_lane(LaneType::Driving, Direction::Backward);

        assert_eq!(separator_marking(&shoulder, &forward, false), None);
        assert_eq!(separator_marking(&forward, &backward, false), Some("center line"));
        assert_eq!(separator_marking(&forward, &forward, false), Some("lane separator"));
        assert_eq!(
            separator_marking(&forward, &forward, true),
            Some("auxiliary lane separator")
        );
    }

    #[test]
    fn puts_the_edge_line_inside_a_shoulder_but_on_a_shoulderless_pavement_edge() {
        let shoulder = test_lane(LaneType::Shoulder, Direction::Forward);
        let driving = test_lane(LaneType::Driving, Direction::Forward);

        let with_shoulders = traveled_way_edges(&[
            shoulder.clone(),
            driving.clone(),
            driving.clone(),
            shoulder.clone(),
        ]);
        assert_eq!(
            with_shoulders,
            vec![
                (FogLineSide::Left, Distance::feet(12.0)),
                (FogLineSide::Right, Distance::feet(36.0)),
            ]
        );

        let without_shoulders = traveled_way_edges(&[driving.clone(), driving.clone()]);
        assert_eq!(
            without_shoulders,
            vec![
                (FogLineSide::Left, Distance::ZERO),
                (FogLineSide::Right, Distance::feet(24.0)),
            ]
        );

        assert!(traveled_way_edges(&[shoulder]).is_empty());
    }

    #[test]
    fn names_edge_lines_from_the_driver_s_side_not_the_lane_order() {
        let forward = test_lane(LaneType::Driving, Direction::Forward);
        let backward = test_lane(LaneType::Driving, Direction::Backward);

        // One-way digitised along traffic: lane order and travel agree.
        let oneway = [forward.clone(), forward.clone()];
        assert_eq!(edge_marking_name(&oneway, FogLineSide::Left), "left fog line");
        assert_eq!(
            edge_marking_name(&oneway, FogLineSide::Right),
            "right fog line"
        );

        // One-way digitised against traffic: the sides swap.
        let reversed = [backward.clone(), backward.clone()];
        assert_eq!(
            edge_marking_name(&reversed, FogLineSide::Left),
            "right fog line"
        );
        assert_eq!(
            edge_marking_name(&reversed, FogLineSide::Right),
            "left fog line"
        );

        // Undivided two-way: every outer edge is some driver's right, so no
        // yellow belongs on either one.
        let two_way = [backward, forward];
        assert_eq!(
            edge_marking_name(&two_way, FogLineSide::Left),
            "right fog line"
        );
        assert_eq!(
            edge_marking_name(&two_way, FogLineSide::Right),
            "right fog line"
        );
    }

    #[test]
    fn reads_the_geometry_sense_from_the_serialized_lane_directions() {
        let forward = json!([{"lt": "Shoulder", "dir": "Forward"}, {"lt": "Driving", "dir": "Forward"}]);
        let backward = json!([{"lt": "Driving", "dir": "Backward"}]);

        assert!(geometry_runs_with_traffic(&forward));
        assert!(!geometry_runs_with_traffic(&backward));
    }

    fn test_lane(lane_type: LaneType, direction: Direction) -> LaneSpec {
        LaneSpec {
            lt: lane_type,
            dir: direction,
            width: Distance::feet(12.0),
            allowed_turns: Default::default(),
            lane: None,
        }
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

    #[test]
    fn identifies_a_same_side_mainline_ramp_pair_as_an_auxiliary_lane() {
        let curved_mainline = [[0.0, 0.0], [30.0, 40.0], [30.0, 80.0]];
        assert_eq!(
            merge_lane_zone(
                "motorway",
                &curved_mainline,
                Some(MergeLaneSides {
                    traffic_side: "right",
                    geometry_side: "right",
                })
            ),
            Some(MergeLaneZone {
                side: "right",
                geometry_side: "right",
                start_arc_feet: 0.0,
                end_arc_feet: 90.0,
            })
        );
        assert_eq!(
            merge_lane_zone(
                "motorway_link",
                &curved_mainline,
                Some(MergeLaneSides {
                    traffic_side: "right",
                    geometry_side: "right",
                })
            ),
            None
        );
        assert_eq!(merge_lane_zone("motorway", &curved_mainline, None), None);
    }

    #[test]
    fn uses_the_outer_tagged_lane_position_for_an_auxiliary_lane_side() {
        assert_eq!(lane_side_from_turn_lanes("|||right"), Some("right"));
        assert_eq!(
            lane_side_from_turn_lanes("|||merge_to_left;slight_right"),
            Some("right")
        );
        assert_eq!(lane_side_from_turn_lanes("left|||"), Some("left"));
        assert_eq!(lane_side_from_turn_lanes("through|through|through"), None);
        assert_eq!(opposite_lane_side("right"), "left");
        assert_eq!(opposite_lane_side("left"), "right");
    }

    #[test]
    fn recognizes_a_wider_mainline_fragment_next_to_a_narrower_neighbor() {
        let roads = json!([
            [1, {"highway_type": "motorway", "src_i": 10, "dst_i": 11,
                "lane_specs_ltr": [{"lt": "Driving"}, {"lt": "Driving"}, {"lt": "Driving"}, {"lt": "Driving"}]}],
            [2, {"highway_type": "motorway", "src_i": 10, "dst_i": 12,
                "lane_specs_ltr": [{"lt": "Driving"}, {"lt": "Driving"}, {"lt": "Driving"}]}]
        ]);
        let intersections = json!([
            [10, {"roads": [1, 2]}],
            [11, {"roads": [1]}],
            [12, {"roads": [2]}]
        ]);
        assert!(has_narrower_mainline_neighbor(
            &roads[0][1],
            &roads,
            &intersections
        ));
        assert!(!has_narrower_mainline_neighbor(
            &roads[1][1],
            &roads,
            &intersections
        ));
    }
}

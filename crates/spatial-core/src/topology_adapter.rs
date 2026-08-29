use serde::Deserialize;
use thiserror::Error;

use crate::{
    CoordinateSystem, FeatureProperties, Geometry, LaneRecord, RelationshipRecord, RoadFeature,
    RoadFeatureKind, RoadScene, SceneSource, SceneSourceType, TopologyDiagnostic, Viewport,
};

#[derive(Debug, Error)]
pub enum TopologyAdapterError {
    #[error("could not parse topology scene: {0}")]
    Json(#[from] serde_json::Error),
    #[error("topology scene has an unsupported version")]
    UnsupportedVersion,
}

#[derive(Debug, Deserialize)]
struct TopologyScene {
    version: u8,
    #[serde(rename = "coordinateUnits")]
    coordinate_units: String,
    roads: Vec<TopologyRoad>,
    intersections: Vec<TopologyIntersection>,
    #[serde(default)]
    markings: Vec<TopologyMarking>,
    #[serde(default)]
    diagnostics: Vec<TopologyDiagnostic>,
    #[serde(default, rename = "normalizedTopology")]
    normalized_topology: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct TopologyRoad {
    #[serde(rename = "sourceWayIds")]
    source_way_ids: Vec<i64>,
    layer: i16,
    highway: String,
    #[serde(rename = "laneCount")]
    lane_count: usize,
    #[serde(rename = "centerLine")]
    center_line: Vec<[f64; 2]>,
    #[serde(rename = "surfacePolygon")]
    surface_polygon: Vec<[f64; 2]>,
    #[serde(rename = "widthFeet")]
    width_feet: f64,
    #[serde(default, rename = "endpointNodeIds")]
    endpoint_node_ids: Vec<i64>,
    #[serde(default, rename = "laneRecords")]
    lane_records: Vec<LaneRecord>,
    #[serde(default, rename = "auxiliaryLaneSide")]
    auxiliary_lane_side: Option<String>,
    #[serde(default, rename = "mergeLaneZone")]
    merge_lane_zone: Option<TopologyMergeLaneZone>,
    #[serde(default)]
    bridge: Option<bool>,
    #[serde(default)]
    tunnel: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TopologyMergeLaneZone {
    side: String,
    #[serde(default)]
    geometry_side: Option<String>,
    start_arc_feet: f64,
    end_arc_feet: f64,
}

#[derive(Debug, Deserialize)]
struct TopologyIntersection {
    #[serde(rename = "sourceNodeIds")]
    source_node_ids: Vec<i64>,
    polygon: Vec<[f64; 2]>,
    #[serde(default)]
    relationship: Option<String>,
    #[serde(default, rename = "connectedRoadIds")]
    connected_road_ids: Vec<i64>,
    #[serde(default)]
    relationships: Vec<RelationshipRecord>,
    #[serde(default)]
    layer: i16,
}

#[derive(Debug, Deserialize)]
struct TopologyMarking {
    #[serde(rename = "sourceWayIds")]
    source_way_ids: Vec<i64>,
    #[serde(rename = "type")]
    marking_type: String,
    geometry: Vec<[f64; 2]>,
    #[serde(default)]
    layer: Option<i16>,
}

/// Derives left/right shoulder width in feet directly from the OSM-derived,
/// left-to-right ordered lane records instead of inventing a fixed shoulder
/// width. Returns `None` for a side when the source topology carries no
/// shoulder lane there, rather than presenting an inferred value as fact.
fn shoulder_widths_from_lane_records(lane_records: &[LaneRecord]) -> (Option<f64>, Option<f64>) {
    let left = lane_records
        .iter()
        .find(|lane| lane.lane_type == "shoulder")
        .map(|lane| lane.width_feet);
    let right = lane_records
        .iter()
        .rev()
        .find(|lane| lane.lane_type == "shoulder")
        .map(|lane| lane.width_feet);
    (left, right)
}

/// Returns each boundary shared by two travel lanes as an offset from the
/// centerline. Lane records are ordered left-to-right by osm2streets.
fn driving_lane_boundaries(
    lane_records: &[LaneRecord],
    auxiliary_lane_side: Option<&str>,
) -> Vec<(usize, f64, RoadFeatureKind)> {
    let total_width_feet = lane_records.iter().map(|lane| lane.width_feet).sum::<f64>();
    let mut width_from_left_feet = 0.0;
    let mut boundaries = Vec::new();

    for (index, lanes) in lane_records.windows(2).enumerate() {
        width_from_left_feet += lanes[0].width_feet;
        if lanes[0].lane_type == "driving"
            && lanes[1].lane_type == "driving"
            && lanes[0].direction == lanes[1].direction
        {
            boundaries.push((index, total_width_feet / 2.0 - width_from_left_feet));
        }
    }
    let auxiliary_boundary_index = match auxiliary_lane_side {
        Some("left") => boundaries.first().map(|(index, _)| *index),
        Some("right") => boundaries.last().map(|(index, _)| *index),
        _ => None,
    };
    boundaries
        .into_iter()
        .map(|(index, offset_feet)| {
            let kind = if Some(index) == auxiliary_boundary_index {
                RoadFeatureKind::AuxiliaryLaneLine
            } else {
                RoadFeatureKind::SkipLine
            };
            (index, offset_feet, kind)
        })
        .collect()
}

/// A widened road is centered across every lane in its OSM geometry. Shift the
/// rendering profile half the outer merge-lane width so the existing through
/// lanes remain aligned with the adjoining narrower mainline segment.
fn merge_lane_profile_offset(lane_records: &[LaneRecord], side: Option<&str>) -> f64 {
    let driving_lanes = lane_records
        .iter()
        .filter(|lane| lane.lane_type == "driving")
        .collect::<Vec<_>>();
    match side {
        Some("left") => driving_lanes
            .first()
            .map_or(0.0, |lane| lane.width_feet / 2.0),
        Some("right") => driving_lanes
            .last()
            .map_or(0.0, |lane| -lane.width_feet / 2.0),
        _ => 0.0,
    }
}

fn active_merge_lane_side(road: &TopologyRoad) -> Option<&str> {
    road.merge_lane_zone
        .as_ref()
        .filter(|zone| zone.end_arc_feet > zone.start_arc_feet)
        .map(|zone| zone.geometry_side.as_deref().unwrap_or(zone.side.as_str()))
        .or(road.auxiliary_lane_side.as_deref())
}

fn offset_polyline(points: &[[f64; 2]], offset_feet: f64) -> Vec<[f64; 2]> {
    points
        .iter()
        .enumerate()
        .map(|(index, point)| {
            let previous = points[index.saturating_sub(1)];
            let next = points[(index + 1).min(points.len() - 1)];
            let delta_x = next[0] - previous[0];
            let delta_y = next[1] - previous[1];
            let length = delta_x.hypot(delta_y);
            if length <= f64::EPSILON {
                *point
            } else {
                [
                    point[0] - delta_y / length * offset_feet,
                    point[1] + delta_x / length * offset_feet,
                ]
            }
        })
        .collect()
}

fn ribbon(points: &[[f64; 2]], width_feet: f64) -> Vec<[f64; 2]> {
    let left = offset_polyline(points, width_feet / 2.0);
    let mut right = offset_polyline(points, -width_feet / 2.0);
    if left.len() < 2 || right.len() < 2 {
        return Vec::new();
    }
    let mut ring = left;
    right.reverse();
    ring.extend(right);
    ring.push(ring[0]);
    ring
}

pub fn compile_topology_scene(
    json: &str,
    dataset: impl Into<String>,
) -> Result<RoadScene, TopologyAdapterError> {
    let topology: TopologyScene = serde_json::from_str(json)?;
    if topology.version != 1 || topology.coordinate_units != "feet" {
        return Err(TopologyAdapterError::UnsupportedVersion);
    }
    let diagnostics = topology.diagnostics;
    let normalized_topology = topology.normalized_topology;
    let profile_offsets_by_way = topology
        .roads
        .iter()
        .flat_map(|road| {
            let offset_feet =
                merge_lane_profile_offset(&road.lane_records, active_merge_lane_side(road));
            road.source_way_ids
                .iter()
                .copied()
                .map(move |way_id| (way_id, offset_feet))
        })
        .collect::<std::collections::HashMap<_, _>>();

    let mut features = Vec::new();
    for (index, road) in topology.roads.into_iter().enumerate() {
        if road.center_line.len() < 2 || road.width_feet <= 0.0 {
            continue;
        }
        let osm_id = road.source_way_ids.first().copied();
        let (left_shoulder_width_feet, right_shoulder_width_feet) =
            shoulder_widths_from_lane_records(&road.lane_records);
        let merge_lane_side = active_merge_lane_side(&road);
        let lane_boundaries = driving_lane_boundaries(&road.lane_records, merge_lane_side);
        let rendered_center_line = offset_polyline(
            &road.center_line,
            merge_lane_profile_offset(&road.lane_records, merge_lane_side),
        );
        let rendered_surface_polygon = if merge_lane_side.is_some() {
            ribbon(&rendered_center_line, road.width_feet)
        } else {
            road.surface_polygon.clone()
        };
        let properties = FeatureProperties {
            osm_id,
            source_way_ids: road.source_way_ids.clone(),
            endpoint_node_ids: road.endpoint_node_ids,
            lane_records: road.lane_records,
            bridge: road.bridge,
            tunnel: road.tunnel,
            highway: Some(road.highway),
            lanes: Some(road.lane_count as u16),
            direction: Some("forward".into()),
            left_shoulder_width_feet,
            right_shoulder_width_feet,
            render_width_feet: Some(road.width_feet.max(12.0)),
            ..FeatureProperties::default()
        };
        let id = format!("topology-road-{index}");
        features.push(RoadFeature {
            id: format!("{id}-casing"),
            kind: RoadFeatureKind::RoadCasing,
            layer: road.layer,
            geometry: Geometry::Polygon(vec![rendered_surface_polygon]),
            properties: FeatureProperties {
                render_width_feet: Some((road.width_feet.max(12.0)) + 8.0),
                ..properties.clone()
            },
        });
        features.push(RoadFeature {
            id: format!("{id}-surface"),
            kind: RoadFeatureKind::RoadSurface,
            layer: road.layer,
            geometry: Geometry::LineString(rendered_center_line.clone()),
            properties: FeatureProperties {
                render_width_feet: Some(road.width_feet.max(12.0)),
                ..properties
            },
        });
        for (boundary_index, offset_feet, kind) in lane_boundaries {
            let marking_type = if kind == RoadFeatureKind::AuxiliaryLaneLine {
                "auxiliary lane separator"
            } else {
                "lane separator"
            };
            features.push(RoadFeature {
                id: format!("{id}-skip-line-{boundary_index}"),
                kind,
                layer: road.layer + 1,
                geometry: Geometry::LineString(offset_polyline(&rendered_center_line, offset_feet)),
                properties: FeatureProperties {
                    osm_id,
                    source_way_ids: road.source_way_ids.clone(),
                    marking_type: Some(marking_type.into()),
                    render_width_feet: Some(0.5),
                    ..FeatureProperties::default()
                },
            });
        }
    }
    for (index, intersection) in topology.intersections.into_iter().enumerate() {
        if intersection.polygon.len() < 4 {
            continue;
        }
        features.push(RoadFeature {
            id: format!("topology-intersection-{index}"),
            kind: RoadFeatureKind::IntersectionSurface,
            layer: intersection.layer,
            geometry: Geometry::Polygon(vec![intersection.polygon]),
            properties: FeatureProperties {
                osm_id: intersection.source_node_ids.first().copied(),
                highway: Some("intersection".into()),
                relationship: intersection.relationship,
                connected_road_ids: intersection.connected_road_ids,
                relationships: intersection.relationships,
                render_width_feet: Some(0.0),
                ..FeatureProperties::default()
            },
        });
    }
    for (index, marking) in topology.markings.into_iter().enumerate() {
        if marking.geometry.len() < 2 {
            continue;
        }
        let layer = marking.layer.unwrap_or(0) + 1;
        // Fog lines are open polylines from a single road, not polygon dashes to blend together.
        let fog_line_kind = match marking.marking_type.as_str() {
            "left fog line" => Some(RoadFeatureKind::LeftFogLine),
            "right fog line" => Some(RoadFeatureKind::RightFogLine),
            _ => None,
        };
        if let Some(kind) = fog_line_kind {
            let profile_offset_feet = marking
                .source_way_ids
                .iter()
                .filter_map(|way_id| profile_offsets_by_way.get(way_id))
                .copied()
                .find(|offset_feet| offset_feet.abs() > f64::EPSILON)
                .unwrap_or(0.0);
            features.push(RoadFeature {
                id: format!("topology-fog-line-{index}"),
                kind,
                layer,
                geometry: Geometry::LineString(offset_polyline(
                    &marking.geometry,
                    profile_offset_feet,
                )),
                properties: FeatureProperties {
                    source_way_ids: marking.source_way_ids,
                    marking_type: Some(marking.marking_type),
                    render_width_feet: Some(0.2),
                    ..FeatureProperties::default()
                },
            });
            continue;
        }
    }
    normalize_to_viewport(&mut features);
    Ok(RoadScene {
        version: 1,
        source: SceneSource {
            source_type: SceneSourceType::OsmPbf,
            dataset: dataset.into(),
            generated_at: "topology-worker".into(),
            attribution: "© OpenStreetMap contributors, ODbL 1.0; normalized with osm2streets"
                .into(),
        },
        coordinate_system: CoordinateSystem {
            world_crs: "LOCAL_OSM2STREETS_FEET".into(),
            display_units: "feet".into(),
            origin: "top-left".into(),
            traffic_flow: "bottom-to-top".into(),
        },
        viewport: viewport_for_features(&features),
        features,
        diagnostics,
        normalized_topology,
    })
}

fn normalize_to_viewport(features: &mut [RoadFeature]) {
    let Some([minimum_x, minimum_y, _, _]) = bounds(features) else {
        return;
    };
    for feature in features {
        let points = match &mut feature.geometry {
            Geometry::LineString(points) => points.iter_mut().collect::<Vec<_>>(),
            Geometry::Polygon(rings) => rings.iter_mut().flatten().collect(),
        };
        for point in points {
            point[0] -= minimum_x - 30.0;
            point[1] -= minimum_y - 30.0;
        }
    }
}

fn viewport_for_features(features: &[RoadFeature]) -> Viewport {
    bounds(features)
        .map(|[minimum_x, minimum_y, maximum_x, maximum_y]| Viewport {
            width: maximum_x - minimum_x + 60.0,
            height: maximum_y - minimum_y + 60.0,
        })
        .unwrap_or(Viewport {
            width: 0.0,
            height: 0.0,
        })
}

fn bounds(features: &[RoadFeature]) -> Option<[f64; 4]> {
    features
        .iter()
        .flat_map(|feature| match &feature.geometry {
            Geometry::LineString(points) => points.iter().collect::<Vec<_>>(),
            Geometry::Polygon(rings) => rings.iter().flatten().collect(),
        })
        .fold(None, |bounds, point| {
            Some(match bounds {
                None => [point[0], point[1], point[0], point[1]],
                Some([minimum_x, minimum_y, maximum_x, maximum_y]) => [
                    minimum_x.min(point[0]),
                    minimum_y.min(point[1]),
                    maximum_x.max(point[0]),
                    maximum_y.max(point[1]),
                ],
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_trimmed_roads_and_shared_intersections_to_scene_features() {
        let scene = compile_topology_scene(
            r#"{
                "version": 1,
                "coordinateUnits": "feet",
                "normalizedTopology": {"roads": "preserved"},
                "roads": [{
                    "sourceWayIds": [95, 96],
                    "layer": 0,
                    "highway": "motorway_link",
                    "laneCount": 1,
                    "centerLine": [[10.0, 20.0], [110.0, 20.0]],
                    "surfacePolygon": [[10.0, 14.0], [110.0, 14.0], [110.0, 26.0], [10.0, 26.0], [10.0, 14.0]],
                    "widthFeet": 12.0,
                    "trimStartFeet": 30.0,
                    "trimEndFeet": 0.0
                }],
                "intersections": [{
                    "sourceNodeIds": [700],
                    "polygon": [[0.0, 0.0], [20.0, 0.0], [20.0, 20.0], [0.0, 0.0]]
                }]
            }"#,
            "Mixing Bowl fixture",
        )
        .expect("topology scene should parse");

        assert_eq!(scene.source.source_type, SceneSourceType::OsmPbf);
        assert_eq!(
            scene.normalized_topology,
            Some(serde_json::json!({"roads": "preserved"}))
        );
        assert_eq!(scene.features.len(), 3);
        assert!(scene.features.iter().any(|feature| {
            feature.kind == RoadFeatureKind::RoadSurface
                && feature.properties.osm_id == Some(95)
                && feature.properties.source_way_ids == vec![95, 96]
                && feature.properties.render_width_feet == Some(12.0)
                && matches!(feature.geometry, Geometry::LineString(_))
        }));
        assert!(scene.features.iter().any(|feature| {
            feature.kind == RoadFeatureKind::RoadCasing
                && feature.properties.osm_id == Some(95)
                && feature.properties.render_width_feet == Some(20.0)
                && matches!(feature.geometry, Geometry::Polygon(_))
        }));
        assert!(scene.features.iter().any(|feature| {
            feature.kind == RoadFeatureKind::IntersectionSurface
                && feature.properties.osm_id == Some(700)
        }));
        assert_eq!(scene.viewport.width, 170.0);
        assert_eq!(scene.viewport.height, 86.0);
    }

    #[test]
    fn rejects_unknown_coordinate_units() {
        let error = compile_topology_scene(
            r#"{"version":1,"coordinateUnits":"meters","roads":[],"intersections":[]}"#,
            "test",
        )
        .expect_err("meter coordinates must not enter feet scene");

        assert!(matches!(error, TopologyAdapterError::UnsupportedVersion));
    }

    #[test]
    fn preserves_shoulder_width_for_topology_roads() {
        let scene = compile_topology_scene(
            r#"{
                "version": 1,
                "coordinateUnits": "feet",
                "roads": [{
                    "sourceWayIds": [10],
                    "layer": 0,
                    "highway": "motorway",
                    "laneCount": 2,
                    "centerLine": [[0.0, 0.0], [120.0, 0.0]],
                    "surfacePolygon": [[0.0, -8.0], [120.0, -8.0], [120.0, 8.0], [0.0, 8.0], [0.0, -8.0]],
                    "widthFeet": 28.0,
                    "endpointNodeIds": [1, 2],
                    "laneRecords": []
                }],
                "intersections": []
            }"#,
            "topology shoulder test",
        )
        .expect("topology roadway should compile");

        let surface = scene
            .features
            .iter()
            .find(|feature| feature.kind == RoadFeatureKind::RoadSurface)
            .expect("surface should be present");
        let casing = scene
            .features
            .iter()
            .find(|feature| feature.kind == RoadFeatureKind::RoadCasing)
            .expect("casing should be present");

        assert_eq!(surface.properties.render_width_feet, Some(28.0));
        assert_eq!(casing.properties.render_width_feet, Some(36.0));
    }

    #[test]
    fn anchors_existing_through_lanes_when_an_outer_merge_lane_is_added() {
        let lanes = vec![
            LaneRecord {
                lane_type: "driving".into(),
                direction: "forward".into(),
                width_feet: 12.0,
                source_evidence: None,
            },
            LaneRecord {
                lane_type: "driving".into(),
                direction: "forward".into(),
                width_feet: 12.0,
                source_evidence: None,
            },
            LaneRecord {
                lane_type: "driving".into(),
                direction: "forward".into(),
                width_feet: 12.0,
                source_evidence: None,
            },
            LaneRecord {
                lane_type: "driving".into(),
                direction: "forward".into(),
                width_feet: 12.0,
                source_evidence: None,
            },
        ];

        assert_eq!(merge_lane_profile_offset(&lanes, Some("right")), -6.0);
        assert_eq!(merge_lane_profile_offset(&lanes, Some("left")), 6.0);
        assert_eq!(merge_lane_profile_offset(&lanes, None), 0.0);
    }

    #[test]
    fn generates_lane_separators_only_between_adjacent_driving_lanes() {
        let scene = compile_topology_scene(
            r#"{
                "version": 1,
                "coordinateUnits": "feet",
                "roads": [{
                    "sourceWayIds": [10],
                    "layer": 0,
                    "highway": "motorway",
                    "laneCount": 4,
                    "centerLine": [[0.0, 0.0], [120.0, 0.0]],
                    "surfacePolygon": [[0.0, -24.0], [120.0, -24.0], [120.0, 24.0], [0.0, 24.0], [0.0, -24.0]],
                    "widthFeet": 48.0,
                    "mergeLaneZone": {"side": "right", "geometrySide": "right", "startArcFeet": 0.0, "endArcFeet": 120.0},
                    "laneRecords": [
                        {"laneType": "shoulder", "direction": "forward", "widthFeet": 12.0},
                        {"laneType": "driving", "direction": "forward", "widthFeet": 12.0},
                        {"laneType": "driving", "direction": "forward", "widthFeet": 12.0},
                        {"laneType": "driving", "direction": "forward", "widthFeet": 12.0}
                    ]
                }],
                "intersections": []
            }"#,
            "topology lane separator test",
        )
        .expect("topology roadway should compile");

        let lane_lines = scene
            .features
            .iter()
            .filter(|feature| {
                matches!(
                    feature.kind,
                    RoadFeatureKind::SkipLine | RoadFeatureKind::AuxiliaryLaneLine
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(lane_lines.len(), 2);
        assert_eq!(lane_lines[0].kind, RoadFeatureKind::SkipLine);
        assert_eq!(lane_lines[1].kind, RoadFeatureKind::AuxiliaryLaneLine);
        assert_eq!(
            lane_lines[1].properties.marking_type.as_deref(),
            Some("auxiliary lane separator")
        );
        assert_eq!(lane_lines[0].properties.render_width_feet, Some(0.5));
        assert!(matches!(
            &lane_lines[0].geometry,
            Geometry::LineString(points) if points == &vec![[30.0, 54.0], [150.0, 54.0]]
        ));
        assert!(matches!(
            &lane_lines[1].geometry,
            Geometry::LineString(points) if points == &vec![[30.0, 42.0], [150.0, 42.0]]
        ));
    }

    #[test]
    fn compiles_exit_143_fixture_without_promoting_overpass_to_intersection() {
        let scene = compile_topology_scene(
            include_str!("../../../tools/topology-worker/fixtures/exit-143.json"),
            "Exit 143 golden fixture",
        )
        .expect("Exit 143 fixture should parse");

        let mainline = scene
            .features
            .iter()
            .find(|feature| feature.properties.osm_id == Some(14300))
            .expect("mainline should remain in the normalized scene");
        let ramp = scene
            .features
            .iter()
            .find(|feature| feature.properties.osm_id == Some(14301))
            .expect("connected ramp should remain in the normalized scene");
        let overpass = scene
            .features
            .iter()
            .find(|feature| feature.properties.osm_id == Some(14302))
            .expect("grade-separated overpass should remain in the normalized scene");

        assert_eq!(mainline.layer, 0);
        assert_eq!(ramp.layer, 0);
        assert_eq!(overpass.layer, 1);
        assert_eq!(overpass.properties.bridge, Some(true));
        assert_eq!(overpass.properties.tunnel, Some(false));
        assert_eq!(
            mainline.properties.endpoint_node_ids,
            vec![1430000, 1430001]
        );
        let intersection = scene
            .features
            .iter()
            .find(|feature| feature.kind == RoadFeatureKind::IntersectionSurface)
            .expect("fixture intersection");
        assert_eq!(intersection.layer, -1);
        assert_eq!(mainline.properties.lane_records.len(), 3);
        assert_eq!(ramp.properties.lane_records[0].lane_type, "driving");
        assert_eq!(ramp.properties.lane_records[0].width_feet, 12.0);
        assert_eq!(scene.diagnostics.len(), 1);
        assert_eq!(scene.diagnostics[0].kind, "grade-separated");
        assert_eq!(scene.diagnostics[0].road_ids, vec![0, 2]);
        assert_eq!(scene.diagnostics[0].crossing_point, [400.0, 200.0]);
        assert!(scene.features.iter().any(|feature| {
            feature.kind == RoadFeatureKind::IntersectionSurface
                && feature.properties.osm_id == Some(1430001)
                && feature.properties.relationship.as_deref() == Some("connected-at-node")
                && feature.properties.connected_road_ids == vec![0, 1]
                && feature.properties.relationships.len() == 1
                && feature.properties.relationships[0].road_ids == vec![0, 1]
        }));
        assert!(!scene
            .features
            .iter()
            .any(|feature| feature.kind == RoadFeatureKind::SemanticMarking));
        assert!(!scene
            .features
            .iter()
            .any(|feature| feature.properties.osm_id == Some(14999)));
    }
}

use serde::Deserialize;
use thiserror::Error;

use crate::{
    CoordinateSystem, FeatureProperties, Geometry, LaneRecord, MergeLaneZone, NavigationMap,
    NavigationIntersection, NavigationMarking, NavigationRoad, RelationshipRecord, RoadFeature,
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
}

#[derive(Debug, Deserialize)]
struct TopologyRoad {
    #[serde(default, rename = "topologyRoadId")]
    topology_road_id: Option<i64>,
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
    #[serde(default, rename = "trimStartFeet")]
    trim_start_feet: f64,
    #[serde(default, rename = "trimEndFeet")]
    trim_end_feet: f64,
    #[serde(default, rename = "endpointNodeIds")]
    endpoint_node_ids: Vec<i64>,
    #[serde(default, rename = "laneRecords")]
    lane_records: Vec<LaneRecord>,
    #[serde(default, rename = "mergeLaneZone")]
    merge_lane_zone: Option<MergeLaneZone>,
    #[serde(default)]
    bridge: Option<bool>,
    #[serde(default)]
    tunnel: Option<bool>,
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
    #[serde(default, rename = "topologyRoadId")]
    topology_road_id: Option<i64>,
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

/// osm2streets emits decorative glyphs through the same marking channel as
/// roadway boundaries. They are not part of the boundary model and outnumber
/// real markings several times over, so they stay out of the bridge snapshot.
const GLYPH_MARKING_TYPES: [&str; 2] = ["lane arrow", "path outline"];

/// The topology worker already places every boundary with osm2streets' own
/// mitered offset, so the adapter only has to name the rendering kind.
fn boundary_feature_kind(marking_type: &str) -> Option<(RoadFeatureKind, f64)> {
    match marking_type {
        "left fog line" => Some((RoadFeatureKind::LeftFogLine, 0.2)),
        "right fog line" => Some((RoadFeatureKind::RightFogLine, 0.2)),
        "lane separator" => Some((RoadFeatureKind::SkipLine, 0.5)),
        "auxiliary lane separator" => Some((RoadFeatureKind::AuxiliaryLaneLine, 0.5)),
        _ => None,
    }
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

    let mut features = Vec::new();
    let mut navigation_roads = Vec::new();
    for (index, road) in topology.roads.iter().enumerate() {
        if road.center_line.len() < 2 || road.width_feet <= 0.0 {
            continue;
        }
        // The worker's own road id, not the array position: normalized
        // intersections reference roads by that id in `connectedRoadIds`, and
        // skipped degenerate roads would otherwise shift every later index.
        let topology_road_id = road.topology_road_id.unwrap_or(index as i64);
        let osm_id = road.source_way_ids.first().copied();
        let (left_shoulder_width_feet, right_shoulder_width_feet) =
            shoulder_widths_from_lane_records(&road.lane_records);
        navigation_roads.push(NavigationRoad {
            topology_road_id,
            source_way_ids: road.source_way_ids.clone(),
            endpoint_node_ids: road.endpoint_node_ids.clone(),
            layer: road.layer,
            highway: road.highway.clone(),
            bridge: road.bridge,
            tunnel: road.tunnel,
            lane_records: road.lane_records.clone(),
            center_line: road.center_line.clone(),
            surface_polygon: road.surface_polygon.clone(),
            width_feet: road.width_feet,
            trim_start_feet: road.trim_start_feet,
            trim_end_feet: road.trim_end_feet,
            merge_lane_zone: road.merge_lane_zone.clone(),
        });
        let properties = FeatureProperties {
            osm_id,
            topology_road_id: Some(topology_road_id),
            source_way_ids: road.source_way_ids.clone(),
            endpoint_node_ids: road.endpoint_node_ids.clone(),
            lane_records: road.lane_records.clone(),
            bridge: road.bridge,
            tunnel: road.tunnel,
            highway: Some(road.highway.clone()),
            lanes: Some(road.lane_count as u16),
            direction: Some("forward".into()),
            left_shoulder_width_feet,
            right_shoulder_width_feet,
            render_width_feet: Some(road.width_feet.max(12.0)),
            ..FeatureProperties::default()
        };
        let id = format!("topology-road-{topology_road_id}");
        features.push(RoadFeature {
            id: format!("{id}-casing"),
            kind: RoadFeatureKind::RoadCasing,
            layer: road.layer,
            geometry: Geometry::Polygon(vec![road.surface_polygon.clone()]),
            properties: FeatureProperties {
                render_width_feet: Some((road.width_feet.max(12.0)) + 8.0),
                ..properties.clone()
            },
        });
        features.push(RoadFeature {
            id: format!("{id}-surface"),
            kind: RoadFeatureKind::RoadSurface,
            layer: road.layer,
            geometry: Geometry::LineString(road.center_line.clone()),
            properties: FeatureProperties {
                render_width_feet: Some(road.width_feet.max(12.0)),
                ..properties
            },
        });
    }
    let mut navigation_intersections = Vec::new();
    for (index, intersection) in topology.intersections.iter().enumerate() {
        if intersection.polygon.len() < 4 {
            continue;
        }
        navigation_intersections.push(NavigationIntersection {
            source_node_ids: intersection.source_node_ids.clone(),
            connected_road_ids: intersection.connected_road_ids.clone(),
            layer: intersection.layer,
            relationship: intersection.relationship.clone(),
            relationships: intersection.relationships.clone(),
            polygon: intersection.polygon.clone(),
        });
        features.push(RoadFeature {
            id: format!("topology-intersection-{index}"),
            kind: RoadFeatureKind::IntersectionSurface,
            layer: intersection.layer,
            geometry: Geometry::Polygon(vec![intersection.polygon.clone()]),
            properties: FeatureProperties {
                osm_id: intersection.source_node_ids.first().copied(),
                highway: Some("intersection".into()),
                relationship: intersection.relationship.clone(),
                connected_road_ids: intersection.connected_road_ids.clone(),
                relationships: intersection.relationships.clone(),
                render_width_feet: Some(0.0),
                ..FeatureProperties::default()
            },
        });
    }
    let mut navigation_markings = Vec::new();
    for (index, marking) in topology.markings.iter().enumerate() {
        if marking.geometry.len() < 2 {
            continue;
        }
        let layer = marking.layer.unwrap_or(0) + 1;
        if GLYPH_MARKING_TYPES.contains(&marking.marking_type.as_str()) {
            continue;
        }
        navigation_markings.push(NavigationMarking {
            topology_road_id: marking.topology_road_id,
            source_way_ids: marking.source_way_ids.clone(),
            marking_type: marking.marking_type.clone(),
            layer,
            geometry: marking.geometry.clone(),
        });
        // Boundaries arrive as continuous polylines so the renderer, not the
        // topology engine, owns the VDOT dash cycle.
        let Some((kind, render_width_feet)) = boundary_feature_kind(&marking.marking_type) else {
            continue;
        };
        features.push(RoadFeature {
            id: format!("topology-marking-{index}"),
            kind,
            layer,
            geometry: Geometry::LineString(marking.geometry.clone()),
            properties: FeatureProperties {
                topology_road_id: marking.topology_road_id,
                source_way_ids: marking.source_way_ids.clone(),
                marking_type: Some(marking.marking_type.clone()),
                render_width_feet: Some(render_width_feet),
                ..FeatureProperties::default()
            },
        });
    }
    let [offset_x, offset_y] = normalize_to_viewport(&mut features);
    translate_navigation_map(
        &mut navigation_roads,
        &mut navigation_intersections,
        &mut navigation_markings,
        offset_x,
        offset_y,
    );
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
        navigation_map: Some(NavigationMap {
            version: 1,
            provider: "osm2streets".into(),
            roads: navigation_roads,
            intersections: navigation_intersections,
            markings: navigation_markings,
        }),
    })
}

/// Shifts the snapshot by the translation already applied to the render
/// features so both describe the same scene-feet frame.
fn translate_navigation_map(
    roads: &mut [NavigationRoad],
    intersections: &mut [NavigationIntersection],
    markings: &mut [NavigationMarking],
    offset_x: f64,
    offset_y: f64,
) {
    let translate = |points: &mut Vec<[f64; 2]>| {
        for point in points {
            point[0] += offset_x;
            point[1] += offset_y;
        }
    };
    for road in roads {
        translate(&mut road.center_line);
        translate(&mut road.surface_polygon);
    }
    for intersection in intersections {
        translate(&mut intersection.polygon);
    }
    for marking in markings {
        translate(&mut marking.geometry);
    }
}

fn normalize_to_viewport(features: &mut [RoadFeature]) -> [f64; 2] {
    let Some([minimum_x, minimum_y, _, _]) = bounds(features) else {
        return [0.0, 0.0];
    };
    let offset_x = 30.0 - minimum_x;
    let offset_y = 30.0 - minimum_y;
    for feature in features {
        let points = match &mut feature.geometry {
            Geometry::LineString(points) => points.iter_mut().collect::<Vec<_>>(),
            Geometry::Polygon(rings) => rings.iter_mut().flatten().collect(),
        };
        for point in points {
            point[0] += offset_x;
            point[1] += offset_y;
        }
    }
    [offset_x, offset_y]
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
                "roads": [{
                    "topologyRoadId": 7,
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
    fn publishes_a_navigation_snapshot_in_the_same_frame_as_the_render_features() {
        let scene = compile_topology_scene(
            r#"{
                "version": 1,
                "coordinateUnits": "feet",
                "roads": [{
                    "topologyRoadId": 7,
                    "sourceWayIds": [95],
                    "layer": 0,
                    "highway": "motorway_link",
                    "laneCount": 1,
                    "centerLine": [[10.0, 20.0], [110.0, 20.0]],
                    "surfacePolygon": [[10.0, 14.0], [110.0, 14.0], [110.0, 26.0], [10.0, 26.0], [10.0, 14.0]],
                    "widthFeet": 12.0,
                    "trimStartFeet": 30.0,
                    "trimEndFeet": 5.0
                }],
                "intersections": [{
                    "sourceNodeIds": [700],
                    "connectedRoadIds": [7],
                    "polygon": [[0.0, 0.0], [20.0, 0.0], [20.0, 20.0], [0.0, 0.0]]
                }],
                "markings": [{
                    "sourceWayIds": [95],
                    "type": "lane separator",
                    "geometry": [[10.0, 20.0], [110.0, 20.0]]
                }, {
                    "sourceWayIds": [95],
                    "type": "lane arrow",
                    "geometry": [[10.0, 20.0], [110.0, 20.0]]
                }]
            }"#,
            "navigation snapshot test",
        )
        .expect("topology scene should parse");

        let navigation_map = scene
            .navigation_map
            .as_ref()
            .expect("topology scenes publish a navigation snapshot");
        let surface = scene
            .features
            .iter()
            .find(|feature| feature.kind == RoadFeatureKind::RoadSurface)
            .expect("surface should be present");
        let Geometry::LineString(rendered_center_line) = &surface.geometry else {
            panic!("road surface is a centerline");
        };

        assert_eq!(surface.id, "topology-road-7-surface");
        assert_eq!(surface.properties.topology_road_id, Some(7));
        assert_eq!(navigation_map.roads.len(), 1);
        assert_eq!(navigation_map.roads[0].topology_road_id, 7);
        assert_eq!(navigation_map.roads[0].trim_start_feet, 30.0);
        assert_eq!(navigation_map.roads[0].trim_end_feet, 5.0);
        assert_eq!(&navigation_map.roads[0].center_line, rendered_center_line);
        assert_eq!(navigation_map.roads[0].center_line[0], [40.0, 50.0]);
        assert_eq!(
            navigation_map.intersections[0].connected_road_ids,
            vec![navigation_map.roads[0].topology_road_id]
        );
        assert_eq!(navigation_map.intersections[0].polygon[0], [30.0, 30.0]);
        // Non-fog semantic markings have no render feature yet, but must still
        // reach the snapshot in scene coordinates. Decorative glyphs do not.
        assert_eq!(navigation_map.markings.len(), 1);
        assert_eq!(navigation_map.markings[0].marking_type, "lane separator");
        assert_eq!(navigation_map.markings[0].geometry[0], [40.0, 50.0]);

        let json = serde_json::to_value(&scene).expect("scene should serialize");
        assert_eq!(json["navigationMap"]["provider"], "osm2streets");
        assert_eq!(json["navigationMap"]["roads"][0]["topologyRoadId"], 7);
        assert_eq!(json["features"][1]["properties"]["topologyRoadId"], 7);
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
    fn renders_each_boundary_marking_the_topology_worker_reports() {
        let scene = compile_topology_scene(
            r#"{
                "version": 1,
                "coordinateUnits": "feet",
                "roads": [{
                    "topologyRoadId": 0,
                    "sourceWayIds": [10],
                    "layer": 0,
                    "highway": "motorway",
                    "laneCount": 4,
                    "centerLine": [[0.0, 0.0], [120.0, 0.0]],
                    "surfacePolygon": [[0.0, -24.0], [120.0, -24.0], [120.0, 24.0], [0.0, 24.0], [0.0, -24.0]],
                    "widthFeet": 48.0
                }],
                "intersections": [],
                "markings": [
                    {"sourceWayIds": [10], "type": "lane separator", "geometry": [[0.0, 12.0], [120.0, 12.0]]},
                    {"sourceWayIds": [10], "type": "auxiliary lane separator", "geometry": [[0.0, 0.0], [120.0, 0.0]]},
                    {"sourceWayIds": [10], "type": "left fog line", "geometry": [[0.0, 24.0], [120.0, 24.0]]},
                    {"sourceWayIds": [10], "type": "right fog line", "geometry": [[0.0, -12.0], [120.0, -12.0]]},
                    {"sourceWayIds": [10], "type": "lane arrow", "geometry": [[0.0, 6.0], [120.0, 6.0]]}
                ]
            }"#,
            "topology boundary marking test",
        )
        .expect("topology roadway should compile");

        let kinds = |kind| {
            scene
                .features
                .iter()
                .filter(|feature| feature.kind == kind)
                .count()
        };
        assert_eq!(kinds(RoadFeatureKind::SkipLine), 1);
        assert_eq!(kinds(RoadFeatureKind::AuxiliaryLaneLine), 1);
        assert_eq!(kinds(RoadFeatureKind::LeftFogLine), 1);
        assert_eq!(kinds(RoadFeatureKind::RightFogLine), 1);

        let separator = scene
            .features
            .iter()
            .find(|feature| feature.kind == RoadFeatureKind::SkipLine)
            .expect("lane separator should render");
        assert_eq!(separator.properties.render_width_feet, Some(0.5));
        // Carried through verbatim: the worker already placed it with the
        // native mitered offset.
        assert!(matches!(
            &separator.geometry,
            Geometry::LineString(points) if points == &vec![[30.0, 66.0], [150.0, 66.0]]
        ));

        let navigation_map = scene.navigation_map.expect("snapshot should be present");
        assert_eq!(navigation_map.markings.len(), 4);
        assert!(!navigation_map
            .markings
            .iter()
            .any(|marking| marking.marking_type == "lane arrow"));
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

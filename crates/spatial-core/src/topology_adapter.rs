use serde::Deserialize;
use thiserror::Error;

use crate::corridor::{Fragment, Junction, Travel, build_corridors, clip_outside_polygons};
use crate::{
    CoordinateSystem, FeatureProperties, Geometry, LaneRecord, NavigationIntersection,
    NavigationMap, NavigationMarking, NavigationRoad, RelationshipRecord, RoadFeature,
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

pub fn compile_topology_scene(
    json: &str,
    dataset: impl Into<String>,
) -> Result<RoadScene, TopologyAdapterError> {
    let topology: TopologyScene = serde_json::from_str(json)?;
    if topology.version != 1 || topology.coordinate_units != "feet" {
        return Err(TopologyAdapterError::UnsupportedVersion);
    }
    let diagnostics = topology.diagnostics;

    let fragments = topology
        .roads
        .iter()
        .enumerate()
        .map(|(index, road)| Fragment {
            // The worker's own road id, not the array position: normalized
            // intersections reference roads by that id in `connectedRoadIds`.
            id: road.topology_road_id.unwrap_or(index as i64),
            source_way_ids: road.source_way_ids.clone(),
            endpoint_node_ids: road.endpoint_node_ids.clone(),
            layer: road.layer,
            highway: road.highway.clone(),
            bridge: road.bridge,
            tunnel: road.tunnel,
            lane_records: road.lane_records.clone(),
            lane_count: road.lane_count,
            center_line: road.center_line.clone(),
            width_feet: road.width_feet,
            trim_start_feet: road.trim_start_feet,
            trim_end_feet: road.trim_end_feet,
        })
        .collect::<Vec<_>>();
    let junctions = topology
        .intersections
        .iter()
        .map(|intersection| Junction {
            connected_road_ids: intersection.connected_road_ids.clone(),
            polygon: intersection.polygon.clone(),
        })
        .collect::<Vec<_>>();
    let corridors = build_corridors(&fragments, &junctions);

    // Junction pavement goes under the roads so the corridors, which reach
    // past their ends, overlap it instead of pinching at every shared node.
    // Where only carriageways and ramps meet there is no junction slab at
    // all: the merging pavement is the gore.
    let mut features = Vec::new();
    let mut navigation_intersections = Vec::new();
    let highway_of = fragments
        .iter()
        .map(|fragment| (fragment.id, fragment.highway.as_str()))
        .collect::<std::collections::HashMap<_, _>>();
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
        let freeway_only = intersection
            .connected_road_ids
            .iter()
            .all(|id| highway_of.get(id).is_some_and(|h| is_freeway_highway(h)));
        if freeway_only {
            continue;
        }
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

    let mut navigation_roads = Vec::new();
    for corridor in &corridors {
        let surface_polygon = corridor.surface_polygon(0.0);
        navigation_roads.push(NavigationRoad {
            topology_road_id: corridor.id,
            source_way_ids: corridor.source_way_ids.clone(),
            endpoint_node_ids: corridor.endpoint_node_ids.clone(),
            layer: corridor.layer,
            highway: corridor.highway.clone(),
            bridge: corridor.bridge,
            tunnel: corridor.tunnel,
            lane_records: corridor.lane_records.clone(),
            center_line: corridor.center_line.clone(),
            surface_polygon: surface_polygon.clone(),
            width_feet: corridor.width_feet,
            trim_start_feet: 0.0,
            trim_end_feet: 0.0,
            merge_lane_zone: None,
        });
        let (left_shoulder_width_feet, right_shoulder_width_feet) =
            shoulder_widths_from_lane_records(&corridor.lane_records);
        let properties = FeatureProperties {
            osm_id: corridor.source_way_ids.first().copied(),
            topology_road_id: Some(corridor.id),
            source_way_ids: corridor.source_way_ids.clone(),
            endpoint_node_ids: corridor.endpoint_node_ids.clone(),
            lane_records: corridor.lane_records.clone(),
            bridge: corridor.bridge,
            tunnel: corridor.tunnel,
            highway: Some(corridor.highway.clone()),
            lanes: Some(corridor.lane_count as u16),
            direction: Some("forward".into()),
            left_shoulder_width_feet,
            right_shoulder_width_feet,
            render_width_feet: Some(corridor.width_feet),
            ..FeatureProperties::default()
        };
        let id = format!("topology-road-{}", corridor.id);
        features.push(RoadFeature {
            id: format!("{id}-casing"),
            kind: RoadFeatureKind::RoadCasing,
            layer: corridor.layer,
            geometry: Geometry::Polygon(vec![corridor.surface_polygon(4.0)]),
            properties: FeatureProperties {
                render_width_feet: Some(corridor.width_feet + 8.0),
                ..properties.clone()
            },
        });
        features.push(RoadFeature {
            id: format!("{id}-surface"),
            kind: RoadFeatureKind::RoadSurface,
            layer: corridor.layer,
            geometry: Geometry::LineString(corridor.center_line.clone()),
            properties: properties.clone(),
        });
        // Edge lines follow the smoothed pavement: yellow on the driver's left
        // and white on the right of one-way carriageways; two-way local roads
        // get white edges on both sides.
        let left_kind = match corridor.travel {
            Travel::TwoWay => RoadFeatureKind::RightFogLine,
            Travel::Forward | Travel::Backward => RoadFeatureKind::LeftFogLine,
        };
        for (suffix, kind, line) in [
            ("left-edge", left_kind, corridor.left_edge()),
            (
                "right-edge",
                RoadFeatureKind::RightFogLine,
                corridor.right_edge(),
            ),
        ] {
            // Edge lines stop where they enter another road's pavement, so
            // ramp and mainline edges meet at the pavement corner instead of
            // crossing; the merge zone itself is left for the template author.
            let other_pavement = corridors
                .iter()
                .filter(|other| other.id != corridor.id && other.layer == corridor.layer)
                .map(|other| other.surface_polygon(0.0))
                .collect::<Vec<_>>();
            for (index, piece) in clip_outside_polygons(&line, &other_pavement)
                .into_iter()
                .enumerate()
            {
                features.push(RoadFeature {
                    id: format!("{id}-{suffix}-{index}"),
                    kind: kind.clone(),
                    layer: corridor.layer + 1,
                    geometry: Geometry::LineString(piece),
                    properties: FeatureProperties {
                        topology_road_id: Some(corridor.id),
                        source_way_ids: corridor.source_way_ids.clone(),
                        render_width_feet: Some(0.5),
                        ..FeatureProperties::default()
                    },
                });
            }
        }
    }

    let [offset_x, offset_y] = normalize_to_viewport(&mut features);
    let mut navigation_markings = Vec::new();
    translate_navigation_map(
        &mut navigation_roads,
        &mut navigation_intersections,
        &mut navigation_markings,
        offset_x,
        offset_y,
    );
    let viewport = viewport_for_features(&features);
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
        viewport,
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

fn is_freeway_highway(highway: &str) -> bool {
    matches!(highway, "motorway" | "trunk") || highway.ends_with("_link")
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

    fn line_of(scene: &RoadScene, id: &str) -> Vec<[f64; 2]> {
        let feature = scene
            .features
            .iter()
            .find(|feature| feature.id == id)
            .unwrap_or_else(|| panic!("{id} should be present"));
        let Geometry::LineString(line) = &feature.geometry else {
            panic!("{id} is a polyline");
        };
        line.clone()
    }

    const TWO_FRAGMENT_MAINLINE: &str = r#"{
        "version": 1,
        "coordinateUnits": "feet",
        "roads": [{
            "topologyRoadId": 3,
            "sourceWayIds": [1],
            "endpointNodeIds": [100, 101],
            "layer": 0,
            "highway": "motorway",
            "laneCount": 2,
            "laneRecords": [
                {"laneType": "driving", "direction": "forward", "widthFeet": 12.0},
                {"laneType": "driving", "direction": "forward", "widthFeet": 12.0}
            ],
            "centerLine": [[0.0, 0.0], [0.0, 960.0]],
            "surfacePolygon": [],
            "widthFeet": 24.0,
            "trimStartFeet": 0.0,
            "trimEndFeet": 40.0
        }, {
            "topologyRoadId": 4,
            "sourceWayIds": [2],
            "endpointNodeIds": [101, 102],
            "layer": 0,
            "highway": "motorway",
            "laneCount": 3,
            "laneRecords": [
                {"laneType": "driving", "direction": "forward", "widthFeet": 12.0},
                {"laneType": "driving", "direction": "forward", "widthFeet": 12.0},
                {"laneType": "driving", "direction": "forward", "widthFeet": 12.0}
            ],
            "centerLine": [[6.0, 1040.0], [6.0, 2000.0]],
            "surfacePolygon": [],
            "widthFeet": 36.0,
            "trimStartFeet": 40.0,
            "trimEndFeet": 0.0
        }],
        "intersections": [{
            "sourceNodeIds": [101],
            "connectedRoadIds": [3, 4],
            "relationship": "connected-at-node",
            "polygon": [[-20.0, 980.0], [20.0, 980.0], [20.0, 1020.0], [-20.0, 1020.0], [-20.0, 980.0]]
        }],
        "markings": [{
            "topologyRoadId": 3,
            "sourceWayIds": [1],
            "type": "lane separator",
            "geometry": [[0.0, 0.0], [0.0, 960.0]]
        }]
    }"#;

    #[test]
    fn chains_fragments_into_one_corridor_with_edge_lines_and_no_freeway_slab() {
        let scene = compile_topology_scene(TWO_FRAGMENT_MAINLINE, "corridor fixture")
            .expect("topology scene should parse");

        let kinds = |kind: RoadFeatureKind| {
            scene
                .features
                .iter()
                .filter(|feature| feature.kind == kind)
                .count()
        };
        assert_eq!(kinds(RoadFeatureKind::RoadSurface), 1, "one corridor");
        assert_eq!(kinds(RoadFeatureKind::RoadCasing), 1);
        assert_eq!(kinds(RoadFeatureKind::LeftFogLine), 1);
        assert_eq!(kinds(RoadFeatureKind::RightFogLine), 1);
        assert_eq!(
            kinds(RoadFeatureKind::SkipLine),
            0,
            "worker markings are dropped"
        );
        assert_eq!(
            kinds(RoadFeatureKind::IntersectionSurface),
            0,
            "a carriageway-only junction has no slab"
        );

        let surface = scene
            .features
            .iter()
            .find(|feature| feature.kind == RoadFeatureKind::RoadSurface)
            .expect("surface");
        assert_eq!(surface.id, "topology-road-3-surface");
        assert_eq!(surface.properties.render_width_feet, Some(36.0));
        assert_eq!(surface.properties.source_way_ids, vec![1, 2]);
        assert_eq!(surface.properties.endpoint_node_ids, vec![100, 101, 102]);
        assert_eq!(surface.properties.lanes, Some(3));

        // Driver's left edge (northbound: -x) stays put through the lane
        // gain, which the right edge absorbs.
        let left = line_of(&scene, "topology-road-3-left-edge-0");
        let xs = left.iter().map(|p| p[0]).collect::<Vec<_>>();
        let spread =
            xs.iter().fold(f64::MIN, |a, &b| a.max(b)) - xs.iter().fold(f64::MAX, |a, &b| a.min(b));
        assert!(spread < 0.5, "left edge spread {spread}");
        let right = line_of(&scene, "topology-road-3-right-edge-0");
        assert!((right[0][0] - left[0][0] - 36.0).abs() < 0.5);
        // The trimmed gap at the shared node is closed.
        let center = line_of(&scene, "topology-road-3-surface");
        let longest_gap = center
            .windows(2)
            .map(|pair| (pair[1][1] - pair[0][1]).abs())
            .fold(0.0, f64::max);
        assert!(longest_gap <= 30.0, "longest sample gap {longest_gap}");
    }

    #[test]
    fn publishes_a_navigation_snapshot_in_the_same_frame_as_the_render_features() {
        let scene = compile_topology_scene(TWO_FRAGMENT_MAINLINE, "frame fixture")
            .expect("topology scene should parse");
        let navigation_map = scene.navigation_map.as_ref().expect("snapshot");
        assert_eq!(navigation_map.roads.len(), 1);
        assert_eq!(navigation_map.roads[0].topology_road_id, 3);
        assert_eq!(navigation_map.roads[0].width_feet, 36.0);
        assert_eq!(navigation_map.roads[0].trim_start_feet, 0.0);
        assert_eq!(
            navigation_map.roads[0].center_line,
            line_of(&scene, "topology-road-3-surface")
        );
        assert_eq!(navigation_map.intersections.len(), 1);
        assert_eq!(
            navigation_map.intersections[0].connected_road_ids,
            vec![3, 4]
        );
        assert!(navigation_map.markings.is_empty());
        // Normalized into the 30 ft viewport margin.
        let [min_x, min_y, _, _] = bounds(&scene.features).expect("bounds");
        assert!((min_x - 30.0).abs() < 1e-6 && (min_y - 30.0).abs() < 1e-6);
        assert_eq!(
            navigation_map.intersections[0].polygon[0][1]
                - navigation_map.roads[0].center_line[0][1],
            980.0 - (-20.0),
        );

        let json = serde_json::to_value(&scene).expect("scene serializes");
        assert_eq!(json["navigationMap"]["provider"], "osm2streets");
        assert_eq!(json["navigationMap"]["roads"][0]["topologyRoadId"], 3);
    }

    #[test]
    fn two_way_local_roads_get_white_edges_and_keep_their_junction_slab() {
        let scene = compile_topology_scene(
            r#"{
                "version": 1,
                "coordinateUnits": "feet",
                "roads": [{
                    "topologyRoadId": 1,
                    "sourceWayIds": [10],
                    "layer": 0,
                    "highway": "secondary",
                    "laneCount": 2,
                    "laneRecords": [
                        {"laneType": "driving", "direction": "backward", "widthFeet": 12.0},
                        {"laneType": "driving", "direction": "forward", "widthFeet": 12.0}
                    ],
                    "centerLine": [[0.0, 0.0], [0.0, 400.0]],
                    "surfacePolygon": [],
                    "widthFeet": 24.0
                }, {
                    "topologyRoadId": 2,
                    "sourceWayIds": [11],
                    "layer": 0,
                    "highway": "motorway_link",
                    "laneCount": 1,
                    "laneRecords": [{"laneType": "driving", "direction": "forward", "widthFeet": 12.0}],
                    "centerLine": [[0.0, 400.0], [300.0, 400.0]],
                    "surfacePolygon": [],
                    "widthFeet": 12.0
                }],
                "intersections": [{
                    "sourceNodeIds": [5],
                    "connectedRoadIds": [1, 2],
                    "polygon": [[-10.0, 390.0], [10.0, 390.0], [10.0, 410.0], [-10.0, 410.0], [-10.0, 390.0]]
                }],
                "markings": []
            }"#,
            "local fixture",
        )
        .expect("topology scene should parse");
        let kind_of = |id: &str| {
            scene
                .features
                .iter()
                .find(|feature| feature.id == id)
                .unwrap_or_else(|| panic!("{id}"))
                .kind
                .clone()
        };
        assert_eq!(
            kind_of("topology-road-1-left-edge-0"),
            RoadFeatureKind::RightFogLine
        );
        assert_eq!(
            kind_of("topology-road-1-right-edge-0"),
            RoadFeatureKind::RightFogLine
        );
        assert_eq!(
            kind_of("topology-road-2-left-edge-0"),
            RoadFeatureKind::LeftFogLine
        );
        assert!(
            scene
                .features
                .iter()
                .any(|feature| feature.kind == RoadFeatureKind::IntersectionSurface)
        );
        assert_eq!(
            scene.navigation_map.as_ref().expect("snapshot").roads.len(),
            2
        );
    }

    #[test]
    fn rejects_unknown_coordinate_units() {
        let error = compile_topology_scene(
            r#"{"version": 1, "coordinateUnits": "meters", "roads": [], "intersections": []}"#,
            "bad units",
        )
        .expect_err("meters should be rejected");
        assert!(matches!(error, TopologyAdapterError::UnsupportedVersion));
    }

    #[test]
    fn preserves_shoulder_width_for_topology_roads() {
        let scene = compile_topology_scene(
            r#"{
                "version": 1,
                "coordinateUnits": "feet",
                "roads": [{
                    "topologyRoadId": 9,
                    "sourceWayIds": [10],
                    "layer": 0,
                    "highway": "motorway",
                    "laneCount": 2,
                    "laneRecords": [
                        {"laneType": "shoulder", "direction": "forward", "widthFeet": 4.0},
                        {"laneType": "driving", "direction": "forward", "widthFeet": 12.0},
                        {"laneType": "shoulder", "direction": "forward", "widthFeet": 8.0}
                    ],
                    "centerLine": [[0.0, 0.0], [0.0, 400.0]],
                    "surfacePolygon": [],
                    "widthFeet": 24.0
                }],
                "intersections": [],
                "markings": []
            }"#,
            "shoulder fixture",
        )
        .expect("topology scene should parse");
        let surface = scene
            .features
            .iter()
            .find(|feature| feature.id == "topology-road-9-surface")
            .expect("surface");
        assert_eq!(surface.properties.left_shoulder_width_feet, Some(4.0));
        assert_eq!(surface.properties.right_shoulder_width_feet, Some(8.0));
        // Never narrower than the worker's own width.
        assert_eq!(surface.properties.render_width_feet, Some(24.0));
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
        assert_eq!(mainline.properties.lane_records.len(), 3);
        assert_eq!(ramp.properties.lane_records[0].lane_type, "driving");
        assert_eq!(ramp.properties.lane_records[0].width_feet, 12.0);
        assert_eq!(scene.diagnostics.len(), 1);
        assert_eq!(scene.diagnostics[0].kind, "grade-separated");
        assert_eq!(scene.diagnostics[0].road_ids, vec![0, 2]);
        assert_eq!(scene.diagnostics[0].crossing_point, [400.0, 200.0]);
        // The ramp/mainline node is kept in the snapshot but draws no slab.
        let navigation_map = scene.navigation_map.as_ref().expect("snapshot");
        assert!(navigation_map.intersections.iter().any(|intersection| {
            intersection.source_node_ids == vec![1430001]
                && intersection.relationship.as_deref() == Some("connected-at-node")
                && intersection.connected_road_ids == vec![0, 1]
        }));
        assert!(
            !scene
                .features
                .iter()
                .any(|feature| feature.kind == RoadFeatureKind::IntersectionSurface)
        );
        assert!(
            !scene
                .features
                .iter()
                .any(|feature| feature.properties.osm_id == Some(14999))
        );
    }
}

use serde::Deserialize;
use thiserror::Error;

use crate::{
    CoordinateSystem, FeatureProperties, Geometry, LaneRecord, RelationshipRecord, RoadFeature,
    RoadFeatureKind, RoadScene, SceneSource, SceneSourceType, Viewport,
    TopologyDiagnostic,
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
    #[serde(rename = "sourceWayIds")]
    source_way_ids: Vec<i64>,
    #[serde(rename = "type")]
    _marking_type: String,
    geometry: Vec<[f64; 2]>,
    #[serde(default)]
    layer: Option<i16>,
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

    let mut features = Vec::new();
    for (index, road) in topology.roads.into_iter().enumerate() {
        if road.center_line.len() < 2 || road.width_feet <= 0.0 {
            continue;
        }
        let osm_id = road.source_way_ids.first().copied();
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
            render_width_feet: Some(road.width_feet),
            ..FeatureProperties::default()
        };
        let id = format!("topology-road-{index}");
        features.push(RoadFeature {
            id: format!("{id}-casing"),
            kind: RoadFeatureKind::RoadCasing,
            layer: road.layer,
            geometry: Geometry::Polygon(vec![road.surface_polygon.clone()]),
            properties: FeatureProperties {
                render_width_feet: Some(0.0),
                ..properties.clone()
            },
        });
        features.push(RoadFeature {
            id: format!("{id}-surface"),
            kind: RoadFeatureKind::RoadSurface,
            layer: road.layer,
            geometry: Geometry::LineString(road.center_line.clone()),
            properties: FeatureProperties {
                render_width_feet: Some(0.0),
                ..properties
            },
        });
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
    let mut marking_groups = std::collections::BTreeMap::<i16, (Vec<Vec<[f64; 2]>>, Vec<i64>)>::new();
    for marking in topology.markings {
        if marking.geometry.len() < 2 {
            continue;
        }
        let entry = marking_groups
            .entry(marking.layer.unwrap_or(0) + 1)
            .or_default();
        entry.0.push(marking.geometry);
        entry.1.extend(marking.source_way_ids);
    }
    for (layer, (marking_rings, mut marking_source_way_ids)) in marking_groups {
        marking_source_way_ids.sort_unstable();
        marking_source_way_ids.dedup();
        features.push(RoadFeature {
            id: format!("topology-markings-{layer}"),
            kind: RoadFeatureKind::SemanticMarking,
            layer,
            geometry: Geometry::Polygon(marking_rings),
            properties: FeatureProperties {
                source_way_ids: marking_source_way_ids,
                marking_type: Some("normalized marking".into()),
                render_width_feet: Some(0.0),
                ..FeatureProperties::default()
            },
        });
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
                && feature.properties.render_width_feet == Some(0.0)
                && matches!(feature.geometry, Geometry::LineString(_))
        }));
        assert!(scene.features.iter().any(|feature| {
            feature.kind == RoadFeatureKind::RoadCasing
                && feature.properties.osm_id == Some(95)
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
        assert!(scene.features.iter().any(|feature| {
            feature.kind == RoadFeatureKind::SemanticMarking
                && feature.properties.source_way_ids == vec![14301]
                && feature.properties.marking_type.as_deref() == Some("normalized marking")
                && matches!(&feature.geometry, Geometry::Polygon(rings) if rings.len() == 1)
        }));
        assert!(
            !scene
                .features
                .iter()
                .any(|feature| feature.properties.osm_id == Some(14999))
        );
    }
}

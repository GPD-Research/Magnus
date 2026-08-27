use serde::Deserialize;
use thiserror::Error;

use crate::{
    CoordinateSystem, FeatureProperties, Geometry, RoadFeature, RoadFeatureKind, RoadScene,
    SceneSource, SceneSourceType, Viewport,
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
    #[serde(rename = "widthFeet")]
    width_feet: f64,
}

#[derive(Debug, Deserialize)]
struct TopologyIntersection {
    #[serde(rename = "sourceNodeIds")]
    source_node_ids: Vec<i64>,
    polygon: Vec<[f64; 2]>,
}

pub fn compile_topology_scene(
    json: &str,
    dataset: impl Into<String>,
) -> Result<RoadScene, TopologyAdapterError> {
    let topology: TopologyScene = serde_json::from_str(json)?;
    if topology.version != 1 || topology.coordinate_units != "feet" {
        return Err(TopologyAdapterError::UnsupportedVersion);
    }

    let mut features = Vec::new();
    for (index, road) in topology.roads.into_iter().enumerate() {
        if road.center_line.len() < 2 || road.width_feet <= 0.0 {
            continue;
        }
        let osm_id = road.source_way_ids.first().copied();
        let properties = FeatureProperties {
            osm_id,
            highway: Some(road.highway),
            lanes: None,
            direction: Some("forward".into()),
            render_width_feet: Some(road.width_feet),
            ..FeatureProperties::default()
        };
        let id = format!("topology-road-{index}");
        features.push(RoadFeature {
            id: format!("{id}-casing"),
            kind: RoadFeatureKind::RoadCasing,
            layer: road.layer,
            geometry: Geometry::LineString(road.center_line.clone()),
            properties: FeatureProperties {
                render_width_feet: Some(road.width_feet + 8.0),
                ..properties.clone()
            },
        });
        features.push(RoadFeature {
            id: format!("{id}-surface"),
            kind: RoadFeatureKind::RoadSurface,
            layer: road.layer,
            geometry: Geometry::LineString(road.center_line.clone()),
            properties,
        });
        append_normalized_markings(&mut features, &id, road.layer, &road.center_line, road.width_feet, road.lane_count);
    }
    for (index, intersection) in topology.intersections.into_iter().enumerate() {
        if intersection.polygon.len() < 4 {
            continue;
        }
        features.push(RoadFeature {
            id: format!("topology-intersection-{index}"),
            kind: RoadFeatureKind::IntersectionSurface,
            layer: 0,
            geometry: Geometry::Polygon(vec![intersection.polygon]),
            properties: FeatureProperties {
                osm_id: intersection.source_node_ids.first().copied(),
                highway: Some("intersection".into()),
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
            attribution: "© OpenStreetMap contributors, ODbL 1.0; normalized with osm2streets".into(),
        },
        coordinate_system: CoordinateSystem {
            world_crs: "LOCAL_OSM2STREETS_FEET".into(),
            display_units: "feet".into(),
            origin: "top-left".into(),
            traffic_flow: "bottom-to-top".into(),
        },
        viewport: viewport_for_features(&features),
        features,
    })
}

fn append_normalized_markings(
    features: &mut Vec<RoadFeature>,
    feature_prefix: &str,
    layer: i16,
    center_line: &[[f64; 2]],
    width_feet: f64,
    lane_count: usize,
) {
    let half_width = width_feet / 2.0;
    let properties = FeatureProperties {
        render_width_feet: Some(0.5),
        ..FeatureProperties::default()
    };
    for (suffix, kind, offset) in [
        ("left-fog", RoadFeatureKind::LeftFogLine, -half_width),
        ("right-fog", RoadFeatureKind::RightFogLine, half_width),
    ] {
        features.push(RoadFeature {
            id: format!("{feature_prefix}-{suffix}"),
            kind,
            layer: layer + 1,
            geometry: Geometry::LineString(offset_line(center_line, offset)),
            properties: properties.clone(),
        });
    }
    if lane_count > 1 {
        for lane in 1..lane_count {
            let offset = -half_width + width_feet * lane as f64 / lane_count as f64;
            features.push(RoadFeature {
                id: format!("{feature_prefix}-lane-{lane}"),
                kind: RoadFeatureKind::SkipLine,
                layer: layer + 1,
                geometry: Geometry::LineString(offset_line(center_line, offset)),
                properties: properties.clone(),
            });
        }
    }
}

fn offset_line(center_line: &[[f64; 2]], offset: f64) -> Vec<[f64; 2]> {
    center_line
        .iter()
        .enumerate()
        .map(|(index, point)| {
            let previous = center_line[index.saturating_sub(1)];
            let next = center_line[(index + 1).min(center_line.len() - 1)];
            let delta = [next[0] - previous[0], next[1] - previous[1]];
            let length = delta[0].hypot(delta[1]);
            if length <= 1e-9 {
                *point
            } else {
                [point[0] - delta[1] / length * offset, point[1] + delta[0] / length * offset]
            }
        })
        .collect()
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
        .unwrap_or(Viewport { width: 0.0, height: 0.0 })
}

fn bounds(features: &[RoadFeature]) -> Option<[f64; 4]> {
    features
        .iter()
        .flat_map(|feature| match &feature.geometry {
            Geometry::LineString(points) => points.iter().collect::<Vec<_>>(),
            Geometry::Polygon(rings) => rings.iter().flatten().collect(),
        })
        .fold(None, |bounds, point| Some(match bounds {
            None => [point[0], point[1], point[0], point[1]],
            Some([minimum_x, minimum_y, maximum_x, maximum_y]) => [
                minimum_x.min(point[0]),
                minimum_y.min(point[1]),
                maximum_x.max(point[0]),
                maximum_y.max(point[1]),
            ],
        }))
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
                    "sourceWayIds": [95],
                    "layer": 0,
                    "highway": "motorway_link",
                    "laneCount": 1,
                    "centerLine": [[10.0, 20.0], [110.0, 20.0]],
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
        assert_eq!(scene.features.len(), 5);
        assert!(scene.features.iter().any(|feature| {
            feature.kind == RoadFeatureKind::RoadSurface
                && feature.properties.osm_id == Some(95)
                && feature.properties.render_width_feet == Some(12.0)
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
}
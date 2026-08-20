use std::collections::HashMap;

use serde::Deserialize;
use thiserror::Error;

use crate::{
    CoordinateSystem, FeatureProperties, Geometry, RoadFeature, RoadFeatureKind,
    RoadLocationRequest, RoadScene, SceneSource, SceneSourceType, TravelDirection, Viewport,
};

const FEET_PER_METER: f64 = 3.280_839_895;
const SCENE_RADIUS_FEET: f64 = 2_500.0;

#[derive(Debug, Error)]
pub enum OverpassSceneError {
    #[error("could not parse Overpass response: {0}")]
    Json(#[from] serde_json::Error),
    #[error("no tagged exit or mile-marker anchor matched the request")]
    AnchorNotFound,
    #[error("no {0} roadway geometry was found near the requested location")]
    RouteNotFound(String),
}

#[derive(Debug, Deserialize)]
struct OverpassResponse {
    elements: Vec<OverpassElement>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum OverpassElement {
    Node {
        id: i64,
        lat: f64,
        lon: f64,
        #[serde(default)]
        tags: HashMap<String, String>,
    },
    Way {
        id: i64,
        nodes: Vec<i64>,
        #[serde(default)]
        tags: HashMap<String, String>,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone)]
struct NodeRecord {
    latitude: f64,
    longitude: f64,
    tags: HashMap<String, String>,
}

#[derive(Debug)]
struct WayRecord {
    id: i64,
    nodes: Vec<i64>,
    tags: HashMap<String, String>,
}

#[must_use]
pub fn scene_radius_feet() -> f64 {
    SCENE_RADIUS_FEET
}

pub fn compile_overpass_json(
    json: &str,
    request: &RoadLocationRequest,
) -> Result<RoadScene, OverpassSceneError> {
    let response: OverpassResponse = serde_json::from_str(json)?;
    let mut nodes = HashMap::new();
    let mut ways = Vec::new();
    for element in response.elements {
        match element {
            OverpassElement::Node {
                id,
                lat,
                lon,
                tags,
            } => {
                nodes.insert(
                    id,
                    NodeRecord {
                        latitude: lat,
                        longitude: lon,
                        tags,
                    },
                );
            }
            OverpassElement::Way { id, nodes, tags } => {
                ways.push(WayRecord { id, nodes, tags });
            }
            OverpassElement::Other => {}
        }
    }

    let route_ways: Vec<&WayRecord> = ways
        .iter()
        .filter(|way| route_ref_matches(way.tags.get("ref"), &request.highway))
        .collect();
    if route_ways.is_empty() {
        return Err(OverpassSceneError::RouteNotFound(request.highway.clone()));
    }
    let anchor = select_anchor(&nodes, &route_ways, request).ok_or(OverpassSceneError::AnchorNotFound)?;

    let mut features = Vec::new();
    for way in ways {
        let coordinates: Vec<[f64; 2]> = way
            .nodes
            .iter()
            .filter_map(|node_id| nodes.get(node_id))
            .map(|node| oriented_local_feet(node, anchor, &request.direction))
            .collect();
        if coordinates.len() < 2 || !coordinates_near_origin(&coordinates) {
            continue;
        }
        let highway = way.tags.get("highway").cloned().unwrap_or_default();
        let lanes = way
            .tags
            .get("lanes")
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or_else(|| if highway.ends_with("_link") { 1 } else { 2 });
        let width = f64::from(lanes) * 12.0;
        let layer = way
            .tags
            .get("layer")
            .and_then(|value| value.parse::<i16>().ok())
            .unwrap_or(0);
        let properties = FeatureProperties {
            osm_id: Some(way.id),
            name: way.tags.get("name").cloned(),
            highway: Some(highway),
            bridge: Some(way.tags.get("bridge").is_some_and(|value| value != "no")),
            tunnel: Some(way.tags.get("tunnel").is_some_and(|value| value != "no")),
            lanes: Some(lanes),
            direction: Some("forward".into()),
            render_width_feet: Some(width),
        };
        features.push(RoadFeature {
            id: format!("way-{}-casing", way.id),
            kind: RoadFeatureKind::RoadCasing,
            layer,
            geometry: Geometry::LineString(coordinates.clone()),
            properties: FeatureProperties {
                render_width_feet: Some(width + 8.0),
                ..properties.clone()
            },
        });
        features.push(RoadFeature {
            id: format!("way-{}-surface", way.id),
            kind: RoadFeatureKind::RoadSurface,
            layer,
            geometry: Geometry::LineString(coordinates),
            properties,
        });
    }
    features.sort_by_key(|feature| feature.layer);
    let viewport = normalize_to_viewport(&mut features);

    Ok(RoadScene {
        version: 1,
        source: SceneSource {
            source_type: SceneSourceType::OsmApi,
            dataset: format!(
                "OpenStreetMap {} {:?} {:?} {}",
                request.highway, request.direction, request.reference_type, request.reference
            ),
            generated_at: "resolved-live".into(),
            attribution: "© OpenStreetMap contributors, ODbL 1.0; queried via Overpass API".into(),
        },
        coordinate_system: CoordinateSystem {
            world_crs: "LOCAL_ENU_FT_FROM_EPSG:4326".into(),
            display_units: "feet".into(),
            origin: "top-left".into(),
            traffic_flow: "bottom-to-top".into(),
        },
        viewport,
        features,
    })
}

fn select_anchor<'a>(
    nodes: &'a HashMap<i64, NodeRecord>,
    route_ways: &[&WayRecord],
    request: &RoadLocationRequest,
) -> Option<&'a NodeRecord> {
    nodes
        .values()
        .filter(|node| {
            node.tags
                .get("highway")
                .is_some_and(|value| value == "motorway_junction" || value == "milestone")
        })
        .filter_map(|anchor| {
            route_ways
                .iter()
                .filter(|way| way_matches_direction(way, nodes, &request.direction))
                .flat_map(|way| way.nodes.iter().filter_map(|node_id| nodes.get(node_id)))
                .map(|node| geographic_distance_feet(anchor, node))
                .reduce(f64::min)
                .map(|distance| (anchor, distance))
        })
        .min_by(|left, right| left.1.total_cmp(&right.1))
        .map(|(anchor, _)| anchor)
}

fn way_matches_direction(
    way: &WayRecord,
    nodes: &HashMap<i64, NodeRecord>,
    direction: &TravelDirection,
) -> bool {
    if matches!(direction, TravelDirection::All) {
        return true;
    }
    let Some(first) = way.nodes.first().and_then(|id| nodes.get(id)) else {
        return false;
    };
    let Some(last) = way.nodes.last().and_then(|id| nodes.get(id)) else {
        return false;
    };
    let east = last.longitude - first.longitude;
    let north = last.latitude - first.latitude;
    match direction {
        TravelDirection::Northbound => north > 0.0 && north.abs() >= east.abs(),
        TravelDirection::Southbound => north < 0.0 && north.abs() >= east.abs(),
        TravelDirection::Eastbound => east > 0.0 && east.abs() >= north.abs(),
        TravelDirection::Westbound => east < 0.0 && east.abs() >= north.abs(),
        TravelDirection::All => true,
    }
}

fn route_ref_matches(reference: Option<&String>, highway: &str) -> bool {
    let compact_highway: String = highway
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect();
    reference.is_some_and(|reference| {
        reference.split(';').any(|candidate| {
            let compact_candidate: String = candidate
                .chars()
                .filter(|character| character.is_ascii_alphanumeric())
                .flat_map(char::to_uppercase)
                .collect();
            compact_candidate == compact_highway
                || compact_highway
                    .strip_prefix("ROUTE")
                    .is_some_and(|number| compact_candidate == format!("VA{number}"))
        })
    })
}

fn oriented_local_feet(
    node: &NodeRecord,
    anchor: &NodeRecord,
    direction: &TravelDirection,
) -> [f64; 2] {
    let latitude_radians = anchor.latitude.to_radians();
    let east = (node.longitude - anchor.longitude)
        * 111_320.0
        * latitude_radians.cos()
        * FEET_PER_METER;
    let north = (node.latitude - anchor.latitude) * 111_132.0 * FEET_PER_METER;
    match direction {
        TravelDirection::Northbound | TravelDirection::All => [east, -north],
        TravelDirection::Southbound => [-east, north],
        TravelDirection::Eastbound => [-north, -east],
        TravelDirection::Westbound => [north, east],
    }
}

fn geographic_distance_feet(first: &NodeRecord, second: &NodeRecord) -> f64 {
    let [east, south] = oriented_local_feet(second, first, &TravelDirection::Northbound);
    east.hypot(south)
}

fn coordinates_near_origin(coordinates: &[[f64; 2]]) -> bool {
    coordinates
        .iter()
        .any(|point| point[0].hypot(point[1]) <= SCENE_RADIUS_FEET)
}

fn normalize_to_viewport(features: &mut [RoadFeature]) -> Viewport {
    let bounds = features
        .iter()
        .flat_map(|feature| match &feature.geometry {
            Geometry::LineString(points) => points.iter().collect::<Vec<_>>(),
            Geometry::Polygon(rings) => rings.iter().flatten().collect(),
        })
        .fold(None::<[f64; 4]>, |bounds, point| {
            Some(match bounds {
                None => [point[0], point[1], point[0], point[1]],
                Some([minimum_x, minimum_y, maximum_x, maximum_y]) => [
                    minimum_x.min(point[0]),
                    minimum_y.min(point[1]),
                    maximum_x.max(point[0]),
                    maximum_y.max(point[1]),
                ],
            })
        });
    let Some([minimum_x, minimum_y, maximum_x, maximum_y]) = bounds else {
        return Viewport { width: 0.0, height: 0.0 };
    };
    let padding = 30.0;
    for feature in features {
        if let Geometry::LineString(points) = &mut feature.geometry {
            for point in points {
                point[0] = point[0] - minimum_x + padding;
                point[1] = point[1] - minimum_y + padding;
            }
        }
    }
    Viewport {
        width: maximum_x - minimum_x + padding * 2.0,
        height: maximum_y - minimum_y + padding * 2.0,
    }
}

#[cfg(test)]
mod tests {
    use crate::{RoadReferenceType, TravelDirection};

    use super::*;

    #[test]
    fn selects_the_requested_route_cluster_and_compiles_real_way_geometry() {
        let response = r#"{
          "elements": [
            {"type":"node","id":1,"lat":38.8000,"lon":-77.2000,"tags":{"highway":"motorway_junction","ref":"166"}},
            {"type":"node","id":2,"lat":38.7990,"lon":-77.2000},
            {"type":"node","id":3,"lat":38.8010,"lon":-77.2000},
            {"type":"way","id":95,"nodes":[2,1,3],"tags":{"highway":"motorway","ref":"I 95","lanes":"3","oneway":"yes"}},
            {"type":"node","id":10,"lat":38.9000,"lon":-77.3000,"tags":{"highway":"motorway_junction","ref":"166"}},
            {"type":"node","id":11,"lat":38.8990,"lon":-77.3000},
            {"type":"node","id":12,"lat":38.9010,"lon":-77.3000},
            {"type":"way","id":7,"nodes":[11,10,12],"tags":{"highway":"primary","ref":"VA 7","lanes":"2"}}
          ]
        }"#;
        let request = RoadLocationRequest {
            highway: "I-95".into(),
            direction: TravelDirection::Northbound,
            reference_type: RoadReferenceType::Exit,
            reference: "166".into(),
        };

        let scene = compile_overpass_json(response, &request).expect("scene should compile");

        assert_eq!(scene.source.source_type, SceneSourceType::OsmApi);
        assert_eq!(scene.features.len(), 2);
        assert_eq!(scene.features[1].properties.osm_id, Some(95));
        assert_eq!(scene.features[1].properties.render_width_feet, Some(36.0));
        assert!(scene.viewport.height > 700.0);
    }
}
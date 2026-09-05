use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use osmpbf::{Element, ElementReader};
use serde_json::json;
use thiserror::Error;

use crate::{
    CoordinateSystem, FeatureProperties, Geometry, RoadFeature, RoadFeatureKind,
    RoadLocationRequest, RoadReferenceType, RoadScene, SceneSource, SceneSourceType, Viewport,
    compile_overpass_json, topology::largest_connected_component,
};

const FEET_PER_METER: f64 = 3.280_839_895;
const LOCAL_SCAN_RADIUS_FEET: f64 = 4_000.0;

#[derive(Debug, Clone)]
pub struct CompileOptions {
    pub dataset_name: String,
    pub generated_at: String,
    pub center_latitude: f64,
    pub center_longitude: f64,
}

#[derive(Debug, Error)]
pub enum SpatialError {
    #[error("could not read OSM PBF: {0}")]
    Pbf(#[from] osmpbf::Error),
    #[error("prepared map does not contain the requested route location")]
    LocationNotFound,
    #[error("could not compile prepared map location: {0}")]
    Scene(String),
}

#[derive(Debug, Clone)]
struct LocationNode {
    latitude: f64,
    longitude: f64,
}

#[derive(Debug)]
struct WayRecord {
    id: i64,
    refs: Vec<i64>,
    highway: String,
    name: Option<String>,
    reference: Option<String>,
    junction_reference: Option<String>,
    destination_reference: Option<String>,
    layer: i16,
    bridge: bool,
    tunnel: bool,
    lanes: u16,
    direction: String,
}

pub fn compile_pbf(
    path: impl AsRef<Path>,
    options: &CompileOptions,
) -> Result<RoadScene, SpatialError> {
    let mut nodes = HashMap::<i64, [f64; 2]>::new();
    ElementReader::from_path(path.as_ref())?.for_each(|element| match element {
        Element::Node(node) => {
            nodes.insert(node.id(), [node.lon(), node.lat()]);
        }
        Element::DenseNode(node) => {
            nodes.insert(node.id(), [node.lon(), node.lat()]);
        }
        _ => {}
    })?;

    let mut ways = Vec::<WayRecord>::new();
    ElementReader::from_path(path.as_ref())?.for_each(|element| {
        if let Element::Way(way) = element {
            let tags: HashMap<&str, &str> = way.tags().collect();
            let Some(highway) = tags.get("highway") else {
                return;
            };
            let lanes = tags
                .get("lanes")
                .and_then(|value| value.parse().ok())
                .unwrap_or(1);
            let bridge = tags.get("bridge").is_some_and(|value| *value != "no");
            let tunnel = tags.get("tunnel").is_some_and(|value| *value != "no");
            let layer = tags
                .get("layer")
                .and_then(|value| value.parse().ok())
                .unwrap_or_else(|| {
                    // OSM contributors frequently omit `layer` on bridges/tunnels since it is implied by convention.
                    if bridge {
                        1
                    } else if tunnel {
                        -1
                    } else {
                        0
                    }
                });
            ways.push(WayRecord {
                id: way.id(),
                refs: way.refs().collect(),
                highway: (*highway).to_owned(),
                name: tags.get("name").map(|value| (*value).to_owned()),
                reference: tags.get("ref").map(|value| (*value).to_owned()),
                junction_reference: tags.get("junction:ref").map(|value| (*value).to_owned()),
                destination_reference: tags.get("destination:ref").map(|value| (*value).to_owned()),
                layer,
                bridge,
                tunnel,
                lanes,
                direction: if tags.get("oneway").is_some_and(|value| *value == "-1") {
                    "backward".into()
                } else {
                    "forward".into()
                },
            });
        }
    })?;

    let way_nodes = ways
        .iter()
        .map(|way| (way.id, way.refs.clone()))
        .collect::<HashMap<_, _>>();
    let connected_way_ids = largest_connected_component(&way_nodes);

    let mut features = Vec::new();
    for way in ways {
        if !connected_way_ids.contains(&way.id) {
            continue;
        }
        let coordinates: Vec<[f64; 2]> = way
            .refs
            .iter()
            .filter_map(|node_id| nodes.get(node_id))
            .map(|coordinate| project_local_feet(*coordinate, options))
            .collect();
        if coordinates.len() < 2 {
            continue;
        }
        let width = f64::from(way.lanes) * 12.0;
        let properties = FeatureProperties {
            osm_id: Some(way.id),
            topology_road_id: None,
            source_way_ids: Vec::new(),
            endpoint_node_ids: Vec::new(),
            lane_records: Vec::new(),
            relationship: None,
            connected_road_ids: Vec::new(),
            relationships: Vec::new(),
            name: way.name,
            highway: Some(way.highway),
            reference: way.reference,
            junction_reference: way.junction_reference,
            destination_reference: way.destination_reference,
            bridge: Some(way.bridge),
            tunnel: Some(way.tunnel),
            lanes: Some(way.lanes),
            left_shoulder_width_feet: None,
            right_shoulder_width_feet: None,
            direction: Some(way.direction),
            render_width_feet: Some(width),
            marking_type: None,
        };
        features.push(RoadFeature {
            id: format!("way-{}-casing", way.id),
            kind: RoadFeatureKind::RoadCasing,
            layer: way.layer,
            geometry: Geometry::LineString(coordinates.clone()),
            properties: FeatureProperties {
                render_width_feet: Some(width + 8.0),
                ..properties.clone()
            },
        });
        features.push(RoadFeature {
            id: format!("way-{}-surface", way.id),
            kind: RoadFeatureKind::RoadSurface,
            layer: way.layer,
            geometry: Geometry::LineString(coordinates),
            properties,
        });
    }
    features.sort_by_key(|feature| feature.layer);
    let viewport = normalize_to_viewport(&mut features);

    Ok(RoadScene {
        version: 1,
        source: SceneSource {
            source_type: SceneSourceType::OsmPbf,
            dataset: options.dataset_name.clone(),
            generated_at: options.generated_at.clone(),
            attribution: "© OpenStreetMap contributors, ODbL 1.0".into(),
        },
        coordinate_system: CoordinateSystem {
            world_crs: "LOCAL_ENU_FT_FROM_EPSG:4326".into(),
            display_units: "feet".into(),
            origin: "top-left".into(),
            traffic_flow: "bottom-to-top".into(),
        },
        viewport,
        features,
        diagnostics: Vec::new(),
        navigation_map: None,
    })
}

pub fn compile_pbf_location(
    path: impl AsRef<Path>,
    request: &RoadLocationRequest,
) -> Result<RoadScene, SpatialError> {
    let path = path.as_ref();
    let mut candidates = Vec::new();
    let mut route_node_ids = HashSet::new();
    ElementReader::from_path(path)?.for_each(|element| match element {
        Element::Node(node) => collect_location_candidate(
            node.id(),
            node.lat(),
            node.lon(),
            node.tags(),
            request,
            &mut candidates,
        ),
        Element::DenseNode(node) => collect_location_candidate(
            node.id(),
            node.lat(),
            node.lon(),
            node.tags(),
            request,
            &mut candidates,
        ),
        Element::Way(way)
            if route_reference_matches(
                way.tags()
                    .find(|(key, _)| *key == "ref")
                    .map(|(_, value)| value),
                &request.highway,
            ) =>
        {
            route_node_ids.extend(way.refs());
        }
        _ => {}
    })?;

    let mut route_nodes = Vec::new();
    ElementReader::from_path(path)?.for_each(|element| match element {
        Element::Node(node) if route_node_ids.contains(&node.id()) => {
            route_nodes.push(LocationNode {
                latitude: node.lat(),
                longitude: node.lon(),
            });
        }
        Element::DenseNode(node) if route_node_ids.contains(&node.id()) => {
            route_nodes.push(LocationNode {
                latitude: node.lat(),
                longitude: node.lon(),
            });
        }
        _ => {}
    })?;
    let anchor = candidates
        .into_iter()
        .filter_map(|candidate| {
            let distance = route_nodes
                .iter()
                .map(|route_node| geographic_distance_feet(&candidate, route_node))
                .reduce(f64::min)?;
            (distance <= 500.0).then_some((candidate, distance))
        })
        .min_by(|first, second| first.1.total_cmp(&second.1))
        .map(|(candidate, _)| candidate)
        .or_else(|| estimate_route_anchor(&route_nodes, request))
        .ok_or(SpatialError::LocationNotFound)?;

    let mut nearby_nodes = HashMap::new();
    ElementReader::from_path(path)?.for_each(|element| match element {
        Element::Node(node) if coordinate_distance_feet(node.lat(), node.lon(), &anchor) <= LOCAL_SCAN_RADIUS_FEET => {
            nearby_nodes.insert(node.id(), json!({ "type": "node", "id": node.id(), "lat": node.lat(), "lon": node.lon(), "tags": node.tags().collect::<HashMap<_, _>>() }));
        }
        Element::DenseNode(node) if coordinate_distance_feet(node.lat(), node.lon(), &anchor) <= LOCAL_SCAN_RADIUS_FEET => {
            nearby_nodes.insert(node.id(), json!({ "type": "node", "id": node.id(), "lat": node.lat(), "lon": node.lon(), "tags": node.tags().collect::<HashMap<_, _>>() }));
        }
        _ => {}
    })?;

    let mut elements = nearby_nodes.values().cloned().collect::<Vec<_>>();
    ElementReader::from_path(path)?.for_each(|element| {
        let Element::Way(way) = element else { return };
        let tags = way.tags().collect::<HashMap<_, _>>();
        if !tags
            .get("highway")
            .is_some_and(|value| is_rendered_highway(value))
        {
            return;
        }
        let nodes = way.refs().collect::<Vec<_>>();
        if nodes
            .iter()
            .filter(|node_id| nearby_nodes.contains_key(node_id))
            .count()
            < 2
        {
            return;
        }
        elements.push(json!({ "type": "way", "id": way.id(), "nodes": nodes, "tags": tags }));
    })?;

    let body = serde_json::to_string(&json!({ "elements": elements }))
        .map_err(|error| SpatialError::Scene(error.to_string()))?;
    let mut scene = compile_overpass_json(&body, request)
        .map_err(|error| SpatialError::Scene(error.to_string()))?;
    scene.source.source_type = SceneSourceType::OsmPbf;
    scene.source.dataset = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("prepared OSM package")
        .into();
    scene.source.generated_at = "resolved-offline".into();
    scene.source.attribution =
        "© OpenStreetMap contributors, ODbL 1.0; loaded from prepared local map data".into();
    Ok(scene)
}

fn collect_location_candidate<'a>(
    _id: i64,
    latitude: f64,
    longitude: f64,
    tags: impl Iterator<Item = (&'a str, &'a str)>,
    request: &RoadLocationRequest,
    candidates: &mut Vec<LocationNode>,
) {
    let tags = tags
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect::<HashMap<_, _>>();
    if anchor_reference_matches(&tags, request) {
        candidates.push(LocationNode {
            latitude,
            longitude,
        });
    }
}

fn anchor_reference_matches(tags: &HashMap<String, String>, request: &RoadLocationRequest) -> bool {
    let expected = request.reference.trim();
    match request.reference_type {
        RoadReferenceType::Exit => {
            tags.get("highway")
                .is_some_and(|value| value == "motorway_junction")
                && tags.get("ref").is_some_and(|value| {
                    value.eq_ignore_ascii_case(expected)
                        || value.strip_prefix(expected).is_some_and(|suffix| {
                            suffix.len() == 1
                                && suffix
                                    .chars()
                                    .all(|character| character.is_ascii_alphabetic())
                        })
                })
        }
        RoadReferenceType::MileMarker => {
            tags.get("highway")
                .is_some_and(|value| value == "milestone")
                && tags.get("distance").is_some_and(|value| {
                    value
                        .parse::<f64>()
                        .ok()
                        .zip(expected.parse::<f64>().ok())
                        .is_some_and(|(actual, requested)| (actual - requested).abs() < 0.01)
                })
        }
    }
}

fn route_reference_matches(reference: Option<&str>, highway: &str) -> bool {
    let compact_highway = compact_route_reference(highway);
    reference.is_some_and(|reference| {
        reference.split(';').any(|candidate| {
            let compact_candidate = compact_route_reference(candidate);
            compact_candidate == compact_highway
                || compact_highway
                    .strip_prefix("ROUTE")
                    .is_some_and(|number| compact_candidate == format!("VA{number}"))
        })
    })
}

fn compact_route_reference(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect()
}

fn estimate_route_anchor(
    route_nodes: &[LocationNode],
    request: &RoadLocationRequest,
) -> Option<LocationNode> {
    if request.reference_type != RoadReferenceType::MileMarker {
        return None;
    }
    let target_distance = request.reference.trim().parse::<f64>().ok()? * 5_280.0;
    let north_south = coordinate_span(route_nodes, |node| node.latitude)
        >= coordinate_span(route_nodes, |node| node.longitude);
    let origin = route_nodes.iter().min_by(|first, second| {
        let first_axis = if north_south {
            first.latitude
        } else {
            first.longitude
        };
        let second_axis = if north_south {
            second.latitude
        } else {
            second.longitude
        };
        first_axis.total_cmp(&second_axis)
    })?;
    route_nodes
        .iter()
        .min_by(|first, second| {
            (geographic_distance_feet(origin, first) - target_distance)
                .abs()
                .total_cmp(&(geographic_distance_feet(origin, second) - target_distance).abs())
        })
        .filter(|candidate| {
            (geographic_distance_feet(origin, candidate) - target_distance).abs() <= 2_640.0
        })
        .cloned()
}

fn coordinate_span(nodes: &[LocationNode], value: impl Fn(&LocationNode) -> f64) -> f64 {
    let (minimum, maximum) = nodes.iter().map(value).fold(
        (f64::INFINITY, f64::NEG_INFINITY),
        |(minimum, maximum), value| (minimum.min(value), maximum.max(value)),
    );
    maximum - minimum
}

fn geographic_distance_feet(first: &LocationNode, second: &LocationNode) -> f64 {
    coordinate_distance_feet(second.latitude, second.longitude, first)
}

fn coordinate_distance_feet(latitude: f64, longitude: f64, anchor: &LocationNode) -> f64 {
    let east = (longitude - anchor.longitude)
        * 111_320.0
        * anchor.latitude.to_radians().cos()
        * FEET_PER_METER;
    let north = (latitude - anchor.latitude) * 111_132.0 * FEET_PER_METER;
    east.hypot(north)
}

fn is_rendered_highway(value: &str) -> bool {
    matches!(
        value,
        "motorway"
            | "motorway_link"
            | "trunk"
            | "trunk_link"
            | "primary"
            | "primary_link"
            | "secondary"
            | "secondary_link"
    )
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
        return Viewport {
            width: 0.0,
            height: 0.0,
        };
    };
    let padding = features
        .iter()
        .filter_map(|feature| feature.properties.render_width_feet)
        .fold(0.0_f64, f64::max)
        / 2.0
        + 10.0;
    for feature in features {
        match &mut feature.geometry {
            Geometry::LineString(points) => translate_points(points, minimum_x, minimum_y, padding),
            Geometry::Polygon(rings) => {
                for ring in rings {
                    translate_points(ring, minimum_x, minimum_y, padding);
                }
            }
        }
    }
    Viewport {
        width: maximum_x - minimum_x + padding * 2.0,
        height: maximum_y - minimum_y + padding * 2.0,
    }
}

fn translate_points(points: &mut [[f64; 2]], minimum_x: f64, minimum_y: f64, padding: f64) {
    for point in points {
        point[0] = point[0] - minimum_x + padding;
        point[1] = point[1] - minimum_y + padding;
    }
}

fn project_local_feet([longitude, latitude]: [f64; 2], options: &CompileOptions) -> [f64; 2] {
    let latitude_radians = options.center_latitude.to_radians();
    let meters_per_degree_latitude = 111_132.0;
    let meters_per_degree_longitude = 111_320.0 * latitude_radians.cos();
    [
        (longitude - options.center_longitude) * meters_per_degree_longitude * FEET_PER_METER,
        (options.center_latitude - latitude) * meters_per_degree_latitude * FEET_PER_METER,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_geometry_to_a_padded_top_left_viewport() {
        let mut features = vec![RoadFeature {
            id: "road".into(),
            kind: RoadFeatureKind::RoadSurface,
            layer: 0,
            geometry: Geometry::LineString(vec![[-20.0, 10.0], [80.0, 210.0]]),
            properties: FeatureProperties {
                render_width_feet: Some(20.0),
                ..FeatureProperties::default()
            },
        }];

        let viewport = normalize_to_viewport(&mut features);

        assert_eq!(viewport.width, 140.0);
        assert_eq!(viewport.height, 240.0);
        assert_eq!(
            features[0].geometry,
            Geometry::LineString(vec![[20.0, 20.0], [120.0, 220.0]])
        );
    }

    #[test]
    fn matches_local_interstate_and_virginia_route_references() {
        assert!(route_reference_matches(Some("I 95;US 1"), "I-95"));
        assert!(route_reference_matches(Some("VA 28"), "Route 28"));
        assert!(!route_reference_matches(Some("VA 28"), "I-95"));
    }

    #[test]
    fn matches_exit_suffixes_and_numeric_mile_markers() {
        let exit_request = RoadLocationRequest {
            highway: "I-95".into(),
            direction: crate::TravelDirection::Northbound,
            reference_type: RoadReferenceType::Exit,
            reference: "166".into(),
        };
        assert!(anchor_reference_matches(
            &HashMap::from([
                ("highway".into(), "motorway_junction".into()),
                ("ref".into(), "166A".into()),
            ]),
            &exit_request
        ));

        let mile_request = RoadLocationRequest {
            reference_type: RoadReferenceType::MileMarker,
            reference: "170".into(),
            ..exit_request
        };
        assert!(anchor_reference_matches(
            &HashMap::from([
                ("highway".into(), "milestone".into()),
                ("distance".into(), "170.0".into()),
            ]),
            &mile_request
        ));
    }
}

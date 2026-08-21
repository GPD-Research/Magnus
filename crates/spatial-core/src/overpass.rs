use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use thiserror::Error;

use crate::{
    CoordinateSystem, FeatureProperties, Geometry, RoadFeature, RoadFeatureKind,
    RoadLocationRequest, RoadScene, SceneSource, SceneSourceType, TravelDirection, Viewport,
};

const FEET_PER_METER: f64 = 3.280_839_895;
const SCENE_RADIUS_FEET: f64 = 2_640.0;
const LANE_WIDTH_FEET: f64 = 12.0;
const EDGE_LINE_INSET_FEET: f64 = 0.0;
const DEFAULT_FREEWAY_LEFT_SHOULDER_FEET: f64 = 4.0;
const DEFAULT_FREEWAY_RIGHT_SHOULDER_FEET: f64 = 10.0;

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
    let anchors = select_anchors(&nodes, &route_ways);
    if anchors.is_empty() {
        return Err(OverpassSceneError::AnchorNotFound);
    }
    let anchor = anchor_centroid(&anchors);
    let anchor_coordinates: Vec<[f64; 2]> = anchors
        .iter()
        .map(|candidate| oriented_local_feet(candidate, &anchor, &request.direction))
        .collect();
    let scene_bounds = scene_bounds(&anchor_coordinates);
    let mainline_nodes: HashSet<i64> = ways
        .iter()
        .filter(|way| matches!(way.tags.get("highway").map(String::as_str), Some("motorway" | "trunk")))
        .flat_map(|way| way.nodes.iter().copied())
        .collect();

    let mut features = Vec::new();
    for way in ways {
        let mut coordinates: Vec<[f64; 2]> = way
            .nodes
            .iter()
            .filter_map(|node_id| nodes.get(node_id))
            .map(|node| oriented_local_feet(node, &anchor, &request.direction))
            .collect();
        if way.tags.get("oneway").is_some_and(|value| value == "-1") {
            coordinates.reverse();
        }
        let fragments = clip_line_to_scene(&coordinates, scene_bounds);
        if fragments.is_empty() {
            continue;
        }
        let highway = way.tags.get("highway").cloned().unwrap_or_default();
        let lanes = way
            .tags
            .get("lanes")
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or_else(|| if highway.ends_with("_link") { 1 } else { 2 });
        let (left_shoulder_width, right_shoulder_width) =
            shoulder_widths(&way.tags, &highway);
        let lane_width = f64::from(lanes) * LANE_WIDTH_FEET;
        let width = lane_width + left_shoulder_width + right_shoulder_width;
        let layer = way
            .tags
            .get("layer")
            .and_then(|value| value.parse::<i16>().ok())
            .unwrap_or(0);
        let properties = FeatureProperties {
            osm_id: Some(way.id),
            name: way.tags.get("name").cloned(),
            highway: Some(highway.clone()),
            bridge: Some(way.tags.get("bridge").is_some_and(|value| value != "no")),
            tunnel: Some(way.tags.get("tunnel").is_some_and(|value| value != "no")),
            lanes: Some(lanes),
            left_shoulder_width_feet: Some(left_shoulder_width),
            right_shoulder_width_feet: Some(right_shoulder_width),
            direction: Some("forward".into()),
            render_width_feet: Some(width),
        };
        let is_link = highway.ends_with("_link");
        let start_has_gore = is_link && way.nodes.first().is_some_and(|node| mainline_nodes.contains(node));
        let end_has_gore = is_link && way.nodes.last().is_some_and(|node| mainline_nodes.contains(node));
        let fragment_count = fragments.len();
        for (fragment_index, coordinates) in fragments.into_iter().enumerate() {
            let fragment_id = format!("way-{}-{fragment_index}", way.id);
            features.push(RoadFeature {
                id: format!("{fragment_id}-casing"),
                kind: RoadFeatureKind::RoadCasing,
                layer,
                geometry: Geometry::LineString(coordinates.clone()),
                properties: FeatureProperties {
                    render_width_feet: Some(width + 8.0),
                    ..properties.clone()
                },
            });
            features.push(RoadFeature {
                id: format!("{fragment_id}-surface"),
                kind: RoadFeatureKind::RoadSurface,
                layer,
                geometry: Geometry::LineString(coordinates.clone()),
                properties: properties.clone(),
            });
            append_lane_markings(
                &mut features,
                &fragment_id,
                layer,
                &coordinates,
                lanes,
                left_shoulder_width,
                right_shoulder_width,
                &properties,
            );
            if is_link {
                append_direction_arrow(&mut features, &fragment_id, layer, &coordinates, &properties);
                if fragment_index == 0 && start_has_gore {
                    append_ramp_gore(&mut features, &fragment_id, layer, &coordinates, true, &properties);
                }
                if fragment_index + 1 == fragment_count && end_has_gore {
                    append_ramp_gore(&mut features, &fragment_id, layer, &coordinates, false, &properties);
                }
            }
        }
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

fn select_anchors<'a>(
    nodes: &'a HashMap<i64, NodeRecord>,
    route_ways: &[&WayRecord],
) -> Vec<&'a NodeRecord> {
    nodes
        .values()
        .filter(|node| {
            node.tags
                .get("highway")
                .is_some_and(|value| value == "motorway_junction" || value == "milestone")
        })
        .filter(|anchor| {
            route_ways
                .iter()
                .flat_map(|way| way.nodes.iter().filter_map(|node_id| nodes.get(node_id)))
                .map(|node| geographic_distance_feet(anchor, node))
                .reduce(f64::min)
                .is_some_and(|distance| distance <= 500.0)
        })
        .collect()
}

fn anchor_centroid(anchors: &[&NodeRecord]) -> NodeRecord {
    let count = anchors.len() as f64;
    NodeRecord {
        latitude: anchors.iter().map(|anchor| anchor.latitude).sum::<f64>() / count,
        longitude: anchors.iter().map(|anchor| anchor.longitude).sum::<f64>() / count,
        tags: HashMap::new(),
    }
}

fn scene_bounds(anchor_coordinates: &[[f64; 2]]) -> [f64; 4] {
    anchor_coordinates.iter().fold(
        [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY],
        |bounds, point| [
            bounds[0].min(point[0] - SCENE_RADIUS_FEET),
            bounds[1].min(point[1] - SCENE_RADIUS_FEET),
            bounds[2].max(point[0] + SCENE_RADIUS_FEET),
            bounds[3].max(point[1] + SCENE_RADIUS_FEET),
        ],
    )
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

fn clip_line_to_scene(coordinates: &[[f64; 2]], bounds: [f64; 4]) -> Vec<Vec<[f64; 2]>> {
    let mut fragments: Vec<Vec<[f64; 2]>> = Vec::new();
    for segment in coordinates.windows(2) {
        let Some([start, end]) = clip_segment_to_bounds(segment[0], segment[1], bounds) else {
            continue;
        };
        if let Some(fragment) = fragments.last_mut().filter(|fragment| {
            fragment.last().is_some_and(|point| points_are_close(*point, start))
        }) {
            if !points_are_close(*fragment.last().expect("fragment has a point"), end) {
                fragment.push(end);
            }
        } else {
            fragments.push(vec![start, end]);
        }
    }
    fragments
}

fn clip_segment_to_bounds(
    start: [f64; 2],
    end: [f64; 2],
    [minimum_x, minimum_y, maximum_x, maximum_y]: [f64; 4],
) -> Option<[[f64; 2]; 2]> {
    let delta = [end[0] - start[0], end[1] - start[1]];
    let mut start_t: f64 = 0.0;
    let mut end_t: f64 = 1.0;
    for (edge_delta, edge_distance) in [
        (-delta[0], start[0] - minimum_x),
        (delta[0], maximum_x - start[0]),
        (-delta[1], start[1] - minimum_y),
        (delta[1], maximum_y - start[1]),
    ] {
        if edge_delta == 0.0 {
            if edge_distance < 0.0 {
                return None;
            }
            continue;
        }
        let ratio = edge_distance / edge_delta;
        if edge_delta < 0.0 {
            start_t = start_t.max(ratio);
        } else {
            end_t = end_t.min(ratio);
        }
        if start_t > end_t {
            return None;
        }
    }
    Some([
        [start[0] + delta[0] * start_t, start[1] + delta[1] * start_t],
        [start[0] + delta[0] * end_t, start[1] + delta[1] * end_t],
    ])
}

fn points_are_close(first: [f64; 2], second: [f64; 2]) -> bool {
    (first[0] - second[0]).hypot(first[1] - second[1]) < 0.01
}

fn append_lane_markings(
    features: &mut Vec<RoadFeature>,
    feature_prefix: &str,
    layer: i16,
    coordinates: &[[f64; 2]],
    lanes: u16,
    left_shoulder_width: f64,
    right_shoulder_width: f64,
    properties: &FeatureProperties,
) {
    let half_width = f64::from(lanes) * LANE_WIDTH_FEET / 2.0;
    for (suffix, kind, offset) in [
        ("left-edge", RoadFeatureKind::LeftFogLine, -half_width + EDGE_LINE_INSET_FEET),
        ("right-edge", RoadFeatureKind::RightFogLine, half_width - EDGE_LINE_INSET_FEET),
    ] {
        features.push(RoadFeature {
            id: format!("{feature_prefix}-{suffix}"),
            kind,
            layer: layer + 1,
            geometry: Geometry::LineString(offset_line(coordinates, offset)),
            properties: FeatureProperties {
                render_width_feet: Some(0.5),
                ..properties.clone()
            },
        });
    }
    for lane in 1..lanes {
        let offset = -half_width + f64::from(lane) * LANE_WIDTH_FEET;
        features.push(RoadFeature {
            id: format!("{feature_prefix}-lane-{lane}"),
            kind: RoadFeatureKind::SkipLine,
            layer: layer + 1,
            geometry: Geometry::LineString(offset_line(coordinates, offset)),
            properties: FeatureProperties {
                render_width_feet: Some(0.5),
                ..properties.clone()
            },
        });
    }
    for (suffix, offset, width) in [
        ("left-shoulder-edge", -half_width - left_shoulder_width, left_shoulder_width),
        ("right-shoulder-edge", half_width + right_shoulder_width, right_shoulder_width),
    ] {
        if width <= 0.0 {
            continue;
        }
        features.push(RoadFeature {
            id: format!("{feature_prefix}-{suffix}"),
            kind: RoadFeatureKind::ShoulderEdge,
            layer: layer + 1,
            geometry: Geometry::LineString(offset_line(coordinates, offset)),
            properties: FeatureProperties {
                render_width_feet: Some(0.75),
                ..properties.clone()
            },
        });
    }
}

fn shoulder_widths(tags: &HashMap<String, String>, highway: &str) -> (f64, f64) {
    let generic = tags.get("shoulder").map(String::as_str);
    let default_present = matches!(highway, "motorway" | "trunk");
    let left_present =
        shoulder_side_present(tags.get("shoulder:left"), generic, "left", default_present);
    let right_present =
        shoulder_side_present(tags.get("shoulder:right"), generic, "right", default_present);
    let left_width = shoulder_width(
        tags,
        "shoulder:left:width",
        left_present,
        DEFAULT_FREEWAY_LEFT_SHOULDER_FEET,
    );
    let right_width = shoulder_width(
        tags,
        "shoulder:right:width",
        right_present,
        DEFAULT_FREEWAY_RIGHT_SHOULDER_FEET,
    );
    (left_width, right_width)
}

fn shoulder_side_present(
    side: Option<&String>,
    generic: Option<&str>,
    side_name: &str,
    default_present: bool,
) -> bool {
    side.map(String::as_str)
        .map(|value| !matches!(value, "no" | "none"))
        .unwrap_or_else(|| match generic {
            Some("no" | "none") => false,
            Some("yes" | "both") => true,
            Some(value) => value == side_name,
            None => default_present,
        })
}

fn shoulder_width(
    tags: &HashMap<String, String>,
    width_key: &str,
    present: bool,
    default_width: f64,
) -> f64 {
    if !present {
        return 0.0;
    }
    tags.get(width_key)
        .and_then(|value| parse_osm_width_feet(value))
        .or_else(|| tags.get("shoulder:width").and_then(|value| parse_osm_width_feet(value)))
        .unwrap_or(default_width)
}

fn parse_osm_width_feet(value: &str) -> Option<f64> {
    let normalized = value.trim().to_ascii_lowercase();
    if let Some(feet) = normalized.strip_suffix("ft") {
        return feet.trim().parse().ok();
    }
    if let Some(feet) = normalized.strip_suffix('\'') {
        return feet.trim().parse().ok();
    }
    normalized
        .strip_suffix('m')
        .unwrap_or(&normalized)
        .trim()
        .parse::<f64>()
        .ok()
        .map(|meters| meters * FEET_PER_METER)
}

fn append_direction_arrow(
    features: &mut Vec<RoadFeature>,
    feature_prefix: &str,
    layer: i16,
    coordinates: &[[f64; 2]],
    properties: &FeatureProperties,
) {
    let middle = coordinates.len() / 2;
    let start = coordinates[middle.saturating_sub(1)];
    let end = coordinates[middle];
    features.push(RoadFeature {
        id: format!("{feature_prefix}-direction"),
        kind: RoadFeatureKind::DirectionArrow,
        layer: layer + 2,
        geometry: Geometry::LineString(vec![start, end]),
        properties: FeatureProperties { render_width_feet: Some(1.5), ..properties.clone() },
    });
}

fn append_ramp_gore(
    features: &mut Vec<RoadFeature>,
    feature_prefix: &str,
    layer: i16,
    coordinates: &[[f64; 2]],
    at_start: bool,
    properties: &FeatureProperties,
) {
    let (tip, adjacent) = if at_start {
        (coordinates[0], coordinates[1])
    } else {
        (*coordinates.last().expect("ramp has coordinates"), coordinates[coordinates.len() - 2])
    };
    let delta = [adjacent[0] - tip[0], adjacent[1] - tip[1]];
    let length = delta[0].hypot(delta[1]);
    if length == 0.0 {
        return;
    }
    let base = [tip[0] + delta[0] / length * 70.0, tip[1] + delta[1] / length * 70.0];
    let normal = [-delta[1] / length * 7.0, delta[0] / length * 7.0];
    features.push(RoadFeature {
        id: format!("{feature_prefix}-gore-{}", if at_start { "start" } else { "end" }),
        kind: RoadFeatureKind::RampGore,
        layer: layer + 2,
        geometry: Geometry::Polygon(vec![vec![
            tip,
            [base[0] + normal[0], base[1] + normal[1]],
            [base[0] - normal[0], base[1] - normal[1]],
            tip,
        ]]),
        properties: properties.clone(),
    });
}

fn offset_line(coordinates: &[[f64; 2]], offset: f64) -> Vec<[f64; 2]> {
    coordinates
        .iter()
        .enumerate()
        .map(|(index, point)| {
            let previous = coordinates[index.saturating_sub(1)];
            let next = coordinates[(index + 1).min(coordinates.len() - 1)];
            let delta_x = next[0] - previous[0];
            let delta_y = next[1] - previous[1];
            let length = delta_x.hypot(delta_y);
            if length == 0.0 {
                *point
            } else {
                [point[0] - delta_y / length * offset, point[1] + delta_x / length * offset]
            }
        })
        .collect()
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
            {"type":"node","id":4,"lat":38.8005,"lon":-77.1990},
            {"type":"way","id":95,"nodes":[2,1,3],"tags":{"highway":"motorway","ref":"I 95","lanes":"3","oneway":"yes"}},
            {"type":"way","id":96,"nodes":[1,4],"tags":{"highway":"motorway_link","lanes":"1","oneway":"yes"}},
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
        assert_eq!(scene.features.len(), 14);
        assert_eq!(scene.features[1].properties.osm_id, Some(95));
        assert_eq!(scene.features[1].properties.render_width_feet, Some(50.0));
        assert_eq!(scene.features.iter().filter(|feature| feature.kind == RoadFeatureKind::SkipLine).count(), 2);
        assert_eq!(scene.features.iter().filter(|feature| matches!(feature.kind, RoadFeatureKind::LeftFogLine | RoadFeatureKind::RightFogLine)).count(), 4);
        assert_eq!(scene.features.iter().filter(|feature| feature.kind == RoadFeatureKind::ShoulderEdge).count(), 2);
        assert_eq!(scene.features.iter().filter(|feature| feature.kind == RoadFeatureKind::RampGore).count(), 1);
        assert_eq!(scene.features.iter().filter(|feature| feature.kind == RoadFeatureKind::DirectionArrow).count(), 1);
        assert!(scene.viewport.height > 700.0);
    }

    #[test]
    fn compiles_tagged_shoulder_widths_and_respects_explicit_absence() {
        let tags = HashMap::from([
            ("shoulder:left".into(), "no".into()),
            ("shoulder:right".into(), "yes".into()),
            ("shoulder:right:width".into(), "3 m".into()),
        ]);

        let (left, right) = shoulder_widths(&tags, "motorway");

        assert_eq!(left, 0.0);
        assert!((right - 9.842_519_685).abs() < 0.001);
    }

    #[test]
    fn clips_long_ways_to_half_a_mile_before_calculating_the_viewport() {
        let points = vec![[0.0, -4_000.0], [0.0, -2_000.0], [0.0, 0.0], [0.0, 2_000.0], [0.0, 4_000.0]];

        let clipped = clip_line_to_scene(
            &points,
            [-SCENE_RADIUS_FEET, -SCENE_RADIUS_FEET, SCENE_RADIUS_FEET, SCENE_RADIUS_FEET],
        );

        assert_eq!(clipped.len(), 1);
        assert_eq!(clipped[0].len(), 5);
        assert!((clipped[0][0][1] + SCENE_RADIUS_FEET).abs() < 0.01);
        assert!((clipped[0][4][1] - SCENE_RADIUS_FEET).abs() < 0.01);
    }
}
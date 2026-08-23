use std::collections::HashMap;

use serde::Deserialize;
use thiserror::Error;

use crate::{
    CoordinateSystem, FeatureProperties, Geometry, RoadFeature, RoadFeatureKind,
    RoadLocationRequest, RoadReferenceType, RoadScene, SceneSource, SceneSourceType,
    TravelDirection, Viewport,
};

const FEET_PER_METER: f64 = 3.280_839_895;
const SCENE_RADIUS_FEET: f64 = 2_640.0;
const LANE_WIDTH_FEET: f64 = 12.0;
const EDGE_LINE_INSET_FEET: f64 = 0.0;
const DEFAULT_FREEWAY_LEFT_SHOULDER_FEET: f64 = 4.0;
const DEFAULT_FREEWAY_RIGHT_SHOULDER_FEET: f64 = 10.0;
const RAMP_GORE_LENGTH_FEET: f64 = 70.0;

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

struct LaneMarkingLayout<'a> {
    lanes: u16,
    left_shoulder_width: f64,
    right_shoulder_width: f64,
    trim_start: bool,
    trim_end: bool,
    /// Arc-length ranges (mainline ways only) where an adjoining ramp turns the edge markings
    /// into an auxiliary-lane treatment instead of a continuous solid edge. Empty for ramps.
    left_zones: &'a [(f64, f64)],
    right_zones: &'a [(f64, f64)],
}

/// The mainline's own tangent direction and half-width at a junction node, used to find where its
/// pavement edge (not its centerline, which is where OSM actually joins the ramp) really is.
struct MainlineAnchor {
    tangent: [f64; 2],
    half_width: f64,
}

fn mainline_edge_anchors(
    ways: &[WayRecord],
    nodes: &HashMap<i64, NodeRecord>,
    anchor: &NodeRecord,
    direction: &TravelDirection,
) -> HashMap<i64, MainlineAnchor> {
    let mut anchors = HashMap::new();
    for way in ways {
        let highway = way.tags.get("highway").map(String::as_str).unwrap_or_default();
        if !matches!(highway, "motorway" | "trunk") {
            continue;
        }
        let lanes = way
            .tags
            .get("lanes")
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(2);
        let (left_shoulder_width, right_shoulder_width) = shoulder_widths(&way.tags, highway);
        let half_width = (f64::from(lanes) * LANE_WIDTH_FEET + left_shoulder_width + right_shoulder_width) / 2.0;
        let points: Vec<(i64, [f64; 2])> = way
            .nodes
            .iter()
            .filter_map(|node_id| nodes.get(node_id).map(|node| (*node_id, oriented_local_feet(node, anchor, direction))))
            .collect();
        for (index, (node_id, _)) in points.iter().enumerate() {
            let previous = points[index.saturating_sub(1)].1;
            let next = points[(index + 1).min(points.len() - 1)].1;
            let delta = [next[0] - previous[0], next[1] - previous[1]];
            let length = delta[0].hypot(delta[1]);
            if length == 0.0 {
                continue;
            }
            anchors.entry(*node_id).or_insert(MainlineAnchor {
                tangent: [delta[0] / length, delta[1] / length],
                half_width,
            });
        }
    }
    anchors
}

/// The point on the mainline's pavement edge (nearest the ramp) below a shared junction node,
/// instead of the node itself, which OSM places on the mainline's centerline.
fn mainline_edge_point(node: [f64; 2], adjacent: [f64; 2], anchor: &MainlineAnchor) -> [f64; 2] {
    let perpendicular = [-anchor.tangent[1], anchor.tangent[0]];
    let sign = mainline_side_sign(node, adjacent, anchor);
    [
        node[0] + perpendicular[0] * anchor.half_width * sign,
        node[1] + perpendicular[1] * anchor.half_width * sign,
    ]
}

/// +1.0 when `adjacent` (a point toward the ramp) lies on the mainline's "right" offset side (the
/// same side `append_lane_markings` uses for its positive fog-line/shoulder-edge offsets), -1.0
/// for the "left" side.
fn mainline_side_sign(node: [f64; 2], adjacent: [f64; 2], anchor: &MainlineAnchor) -> f64 {
    let perpendicular = [-anchor.tangent[1], anchor.tangent[0]];
    let toward_ramp = [adjacent[0] - node[0], adjacent[1] - node[1]];
    if perpendicular[0] * toward_ramp[0] + perpendicular[1] * toward_ramp[1] >= 0.0 { 1.0 } else { -1.0 }
}

/// A ramp's arc-length position along one specific mainline way, and which OSM node it shares.
struct MainlineProfile {
    node_arc: HashMap<i64, f64>,
    total_length: f64,
}

fn build_mainline_profiles(
    ways: &[WayRecord],
    nodes: &HashMap<i64, NodeRecord>,
    anchor: &NodeRecord,
    direction: &TravelDirection,
) -> HashMap<i64, MainlineProfile> {
    let mut profiles = HashMap::new();
    for way in ways {
        let highway = way.tags.get("highway").map(String::as_str).unwrap_or_default();
        if !matches!(highway, "motorway" | "trunk") {
            continue;
        }
        let mut pairs: Vec<(i64, [f64; 2])> = way
            .nodes
            .iter()
            .filter_map(|node_id| nodes.get(node_id).map(|node| (*node_id, oriented_local_feet(node, anchor, direction))))
            .collect();
        if pairs.len() < 2 {
            continue;
        }
        if way.tags.get("oneway").is_some_and(|value| value == "-1") {
            pairs.reverse();
        }
        let points: Vec<[f64; 2]> = pairs.iter().map(|(_, point)| *point).collect();
        let cumulative = cumulative_lengths(&points);
        let mut node_arc = HashMap::new();
        for ((node_id, _), arc) in pairs.iter().zip(cumulative.iter()) {
            node_arc.entry(*node_id).or_insert(*arc);
        }
        profiles.insert(way.id, MainlineProfile { node_arc, total_length: *cumulative.last().unwrap_or(&0.0) });
    }
    profiles
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum RampNoseKind {
    /// The ramp's traffic merges into the mainline here (an on-ramp).
    Entrance,
    /// The ramp's traffic diverges away from the mainline here (an off-ramp).
    Exit,
}

struct RampNose {
    arc_position: f64,
    kind: RampNoseKind,
    side_sign: f64,
}

/// For every mainline way, every ramp that shares one of its junction nodes, tagged by whether the
/// ramp merges in (`Entrance`) or diverges away (`Exit`), and which side of the mainline it's on.
fn build_ramp_noses(
    ways: &[WayRecord],
    mainline_anchors: &HashMap<i64, MainlineAnchor>,
    mainline_profiles: &HashMap<i64, MainlineProfile>,
    nodes: &HashMap<i64, NodeRecord>,
    anchor: &NodeRecord,
    direction: &TravelDirection,
) -> HashMap<i64, Vec<RampNose>> {
    let mut noses: HashMap<i64, Vec<RampNose>> = HashMap::new();
    for way in ways {
        let is_link = way.tags.get("highway").is_some_and(|highway| highway.ends_with("_link"));
        if !is_link {
            continue;
        }
        let mut oriented: Vec<(i64, [f64; 2])> = way
            .nodes
            .iter()
            .filter_map(|node_id| nodes.get(node_id).map(|node| (*node_id, oriented_local_feet(node, anchor, direction))))
            .collect();
        if oriented.len() < 2 {
            continue;
        }
        if way.tags.get("oneway").is_some_and(|value| value == "-1") {
            oriented.reverse();
        }
        let mut add_nose = |node_id: i64, adjacent_point: [f64; 2], node_point: [f64; 2], kind: RampNoseKind| {
            let Some(mainline_anchor) = mainline_anchors.get(&node_id) else { return };
            let side_sign = mainline_side_sign(node_point, adjacent_point, mainline_anchor);
            for (mainline_way_id, profile) in mainline_profiles {
                if let Some(&arc_position) = profile.node_arc.get(&node_id) {
                    noses.entry(*mainline_way_id).or_default().push(RampNose { arc_position, kind, side_sign });
                }
            }
        };
        let (first_id, first_point) = oriented[0];
        let (_, second_point) = oriented[1];
        add_nose(first_id, second_point, first_point, RampNoseKind::Exit);
        let (last_id, last_point) = oriented[oriented.len() - 1];
        let (_, second_last_point) = oriented[oriented.len() - 2];
        add_nose(last_id, second_last_point, last_point, RampNoseKind::Entrance);
    }
    for way_noses in noses.values_mut() {
        way_noses.sort_by(|first, second| first.arc_position.total_cmp(&second.arc_position));
    }
    noses
}

/// An arc-length range (in the mainline's own arc-length units) where its edge markings must
/// reflect an adjoining ramp instead of the mainline's normal solid edge treatment.
struct MarkingZone {
    start: f64,
    end: f64,
    side_sign: f64,
}

/// Real interchanges mark the stretch between a merge and the next, nearby diverge as a
/// continuous auxiliary lane (a dashed interior line, not a solid edge) instead of two separate
/// short acceleration/deceleration zones, so a chained entrance->exit pair shares one zone.
fn compute_marking_zones(noses: &[RampNose], total_length: f64) -> Vec<MarkingZone> {
    let mut zones = Vec::new();
    let mut chained_exit_indices = std::collections::HashSet::new();
    for (index, nose) in noses.iter().enumerate() {
        if nose.kind != RampNoseKind::Entrance {
            continue;
        }
        let chained_exit = noses
            .iter()
            .enumerate()
            .skip(index + 1)
            .find(|(_, candidate)| candidate.kind == RampNoseKind::Exit && candidate.side_sign == nose.side_sign);
        match chained_exit {
            Some((exit_index, exit_nose)) => {
                chained_exit_indices.insert(exit_index);
                zones.push(MarkingZone { start: nose.arc_position, end: exit_nose.arc_position, side_sign: nose.side_sign });
            }
            None => zones.push(MarkingZone {
                start: nose.arc_position,
                end: (nose.arc_position + RAMP_GORE_LENGTH_FEET).min(total_length),
                side_sign: nose.side_sign,
            }),
        }
    }
    for (index, nose) in noses.iter().enumerate() {
        if nose.kind != RampNoseKind::Exit || chained_exit_indices.contains(&index) {
            continue;
        }
        zones.push(MarkingZone {
            start: (nose.arc_position - RAMP_GORE_LENGTH_FEET).max(0.0),
            end: nose.arc_position,
            side_sign: nose.side_sign,
        });
    }
    zones.sort_by(|first, second| first.start.total_cmp(&second.start));
    zones
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
    let (anchor, anchor_coordinates) = if anchors.is_empty() {
        let anchor = estimate_mile_marker_anchor(&nodes, &route_ways, request)
            .ok_or(OverpassSceneError::AnchorNotFound)?;
        (anchor, vec![[0.0, 0.0]])
    } else {
        let anchor = anchor_centroid(&anchors);
        let coordinates = anchors
            .iter()
            .map(|candidate| oriented_local_feet(candidate, &anchor, &request.direction))
            .collect();
        (anchor, coordinates)
    };
    let scene_bounds = scene_bounds(&anchor_coordinates);
    let mainline_anchors = mainline_edge_anchors(&ways, &nodes, &anchor, &request.direction);
    let mainline_profiles = build_mainline_profiles(&ways, &nodes, &anchor, &request.direction);
    let ramp_noses = build_ramp_noses(&ways, &mainline_anchors, &mainline_profiles, &nodes, &anchor, &request.direction);
    let mainline_zones: HashMap<i64, Vec<MarkingZone>> = mainline_profiles
        .iter()
        .map(|(way_id, profile)| {
            let zones = ramp_noses
                .get(way_id)
                .map(|noses| compute_marking_zones(noses, profile.total_length))
                .unwrap_or_default();
            (*way_id, zones)
        })
        .collect();

    let mut features = Vec::new();
    for way in ways {
        let mut coordinates: Vec<[f64; 2]> = way
            .nodes
            .iter()
            .filter_map(|node_id| nodes.get(node_id))
            .map(|node| oriented_local_feet(node, &anchor, &request.direction))
            .collect();
        let is_link = way
            .tags
            .get("highway")
            .is_some_and(|highway| highway.ends_with("_link"));
        let mut start_gore_anchor = is_link
            .then(|| way.nodes.first().and_then(|node| mainline_anchors.get(node)))
            .flatten();
        let mut end_gore_anchor = is_link
            .then(|| way.nodes.last().and_then(|node| mainline_anchors.get(node)))
            .flatten();
        let mut start_has_gore = start_gore_anchor.is_some();
        let mut end_has_gore = end_gore_anchor.is_some();
        if way.tags.get("oneway").is_some_and(|value| value == "-1") {
            coordinates.reverse();
            std::mem::swap(&mut start_has_gore, &mut end_has_gore);
            std::mem::swap(&mut start_gore_anchor, &mut end_gore_anchor);
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
        let layer = inferred_layer(&way.tags);
        let properties = FeatureProperties {
            osm_id: Some(way.id),
            name: way.tags.get("name").cloned(),
            highway: Some(highway.clone()),
            reference: way.tags.get("ref").cloned(),
            junction_reference: way.tags.get("junction:ref").cloned(),
            destination_reference: way.tags.get("destination:ref").cloned(),
            bridge: Some(way.tags.get("bridge").is_some_and(|value| value != "no")),
            tunnel: Some(way.tags.get("tunnel").is_some_and(|value| value != "no")),
            lanes: Some(lanes),
            left_shoulder_width_feet: Some(left_shoulder_width),
            right_shoulder_width_feet: Some(right_shoulder_width),
            direction: Some("forward".into()),
            render_width_feet: Some(width),
        };
        let fragment_count = fragments.len();
        // Zones are computed in the full (unclipped) way's own arc-length units, so they only line
        // up with a fragment that starts at that way's arc 0 — true whenever the mainline fits in
        // a single fragment, the common case for a scene centered on the requested interchange.
        let (left_zone_ranges, right_zone_ranges): (Vec<(f64, f64)>, Vec<(f64, f64)>) = mainline_zones
            .get(&way.id)
            .map(|zones| {
                let left = zones.iter().filter(|zone| zone.side_sign < 0.0).map(|zone| (zone.start, zone.end)).collect();
                let right = zones.iter().filter(|zone| zone.side_sign > 0.0).map(|zone| (zone.start, zone.end)).collect();
                (left, right)
            })
            .unwrap_or_default();
        let no_zones: Vec<(f64, f64)> = Vec::new();
        for (fragment_index, coordinates) in fragments.into_iter().enumerate() {
            let fragment_id = format!("way-{}-{fragment_index}", way.id);
            let trim_marking_start = fragment_index == 0 && start_has_gore;
            let trim_marking_end = fragment_index + 1 == fragment_count && end_has_gore;
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
            // Link pavement is instead drawn by the tapered ribbon below; this centerline stays for selection/placement.
            let surface_render_width = if is_link { 0.0 } else { width };
            features.push(RoadFeature {
                id: format!("{fragment_id}-surface"),
                kind: RoadFeatureKind::RoadSurface,
                layer,
                geometry: Geometry::LineString(coordinates.clone()),
                properties: FeatureProperties {
                    render_width_feet: Some(surface_render_width),
                    ..properties.clone()
                },
            });
            if is_link {
                // The OSM junction node sits on the mainline's centerline, not its edge, so the
                // ramp must taper to the actual pavement edge instead of visually cutting across
                // the through lanes to converge in the middle of the mainline.
                let mut visual_coordinates = coordinates.clone();
                if trim_marking_start {
                    if let (Some(anchor), Some(&adjacent)) =
                        (start_gore_anchor, visual_coordinates.get(1))
                    {
                        visual_coordinates[0] = mainline_edge_point(visual_coordinates[0], adjacent, anchor);
                    }
                }
                if trim_marking_end {
                    let last_index = visual_coordinates.len() - 1;
                    if let (Some(anchor), Some(&adjacent)) =
                        (end_gore_anchor, last_index.checked_sub(1).map(|index| &visual_coordinates[index]))
                    {
                        visual_coordinates[last_index] =
                            mainline_edge_point(visual_coordinates[last_index], adjacent, anchor);
                    }
                }
                append_ramp_ribbon(
                    &mut features,
                    &fragment_id,
                    layer,
                    &visual_coordinates,
                    width,
                    trim_marking_start,
                    trim_marking_end,
                    &properties,
                );
                append_direction_arrow(&mut features, &fragment_id, layer, &visual_coordinates, &properties);
                if fragment_index == 0 && start_has_gore {
                    append_ramp_gore(&mut features, &fragment_id, layer, &visual_coordinates, true, &properties);
                }
                if fragment_index + 1 == fragment_count && end_has_gore {
                    append_ramp_gore(&mut features, &fragment_id, layer, &visual_coordinates, false, &properties);
                }
            }
            append_lane_markings(
                &mut features,
                &fragment_id,
                layer,
                &coordinates,
                LaneMarkingLayout {
                    lanes,
                    left_shoulder_width,
                    right_shoulder_width,
                    trim_start: trim_marking_start,
                    trim_end: trim_marking_end,
                    left_zones: if fragment_index == 0 { &left_zone_ranges } else { &no_zones },
                    right_zones: if fragment_index == 0 { &right_zone_ranges } else { &no_zones },
                },
                &properties,
            );
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

fn estimate_mile_marker_anchor(
    nodes: &HashMap<i64, NodeRecord>,
    route_ways: &[&WayRecord],
    request: &RoadLocationRequest,
) -> Option<NodeRecord> {
    if request.reference_type != RoadReferenceType::MileMarker {
        return None;
    }
    let target_distance = request.reference.trim().parse::<f64>().ok()? * 5_280.0;
    if !target_distance.is_finite() || target_distance < 0.0 {
        return None;
    }
    let route_nodes: Vec<&NodeRecord> = route_ways
        .iter()
        .flat_map(|way| way.nodes.iter())
        .filter_map(|node_id| nodes.get(node_id))
        .collect();
    let latitude_span = route_nodes
        .iter()
        .map(|node| node.latitude)
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(minimum, maximum), value| {
            (minimum.min(value), maximum.max(value))
        });
    let longitude_span = route_nodes
        .iter()
        .map(|node| node.longitude)
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(minimum, maximum), value| {
            (minimum.min(value), maximum.max(value))
        });
    let north_south_route = latitude_span.1 - latitude_span.0 >= longitude_span.1 - longitude_span.0;
    let origin = route_nodes.iter().copied().min_by(|first, second| {
        let first_axis = if north_south_route { first.latitude } else { first.longitude };
        let second_axis = if north_south_route { second.latitude } else { second.longitude };
        first_axis.total_cmp(&second_axis)
    })?;
    let candidate = route_nodes.iter().copied().min_by(|first, second| {
        let first_delta = (geographic_distance_feet(origin, first) - target_distance).abs();
        let second_delta = (geographic_distance_feet(origin, second) - target_distance).abs();
        first_delta.total_cmp(&second_delta)
    })?;
    ((geographic_distance_feet(origin, candidate) - target_distance).abs() <= 2_640.0)
        .then(|| candidate.clone())
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
    layout: LaneMarkingLayout,
    properties: &FeatureProperties,
) {
    let marking_coordinates = trim_line_ends(
        coordinates,
        if layout.trim_start {
            RAMP_GORE_LENGTH_FEET
        } else {
            0.0
        },
        if layout.trim_end {
            RAMP_GORE_LENGTH_FEET
        } else {
            0.0
        },
    );
    if marking_coordinates.len() < 2 {
        return;
    }
    let half_width = f64::from(layout.lanes) * LANE_WIDTH_FEET / 2.0;
    append_edge_line(
        features,
        feature_prefix,
        layer,
        &marking_coordinates,
        "left-edge",
        RoadFeatureKind::LeftFogLine,
        -half_width + EDGE_LINE_INSET_FEET,
        layout.left_zones,
        properties,
    );
    append_edge_line(
        features,
        feature_prefix,
        layer,
        &marking_coordinates,
        "right-edge",
        RoadFeatureKind::RightFogLine,
        half_width - EDGE_LINE_INSET_FEET,
        layout.right_zones,
        properties,
    );
    for lane in 1..layout.lanes {
        let offset = -half_width + f64::from(lane) * LANE_WIDTH_FEET;
        features.push(RoadFeature {
            id: format!("{feature_prefix}-lane-{lane}"),
            kind: RoadFeatureKind::SkipLine,
            layer: layer + 1,
            geometry: Geometry::LineString(offset_line(&marking_coordinates, offset)),
            properties: FeatureProperties {
                render_width_feet: Some(0.5),
                ..properties.clone()
            },
        });
    }
    append_shoulder_edge(
        features,
        feature_prefix,
        layer,
        &marking_coordinates,
        "left-shoulder-edge",
        -half_width - layout.left_shoulder_width,
        layout.left_shoulder_width,
        layout.left_zones,
        properties,
    );
    append_shoulder_edge(
        features,
        feature_prefix,
        layer,
        &marking_coordinates,
        "right-shoulder-edge",
        half_width + layout.right_shoulder_width,
        layout.right_shoulder_width,
        layout.right_zones,
        properties,
    );
}

/// Draws a fog line, splitting it into VDOT's dotted auxiliary-lane pattern (3 ft dash / 9 ft gap)
/// wherever an adjoining ramp's merge/diverge zone reaches this mainline way, and a plain solid
/// line everywhere else (or for ramps, which never carry zones).
fn append_edge_line(
    features: &mut Vec<RoadFeature>,
    feature_prefix: &str,
    layer: i16,
    marking_coordinates: &[[f64; 2]],
    suffix: &str,
    kind: RoadFeatureKind,
    offset: f64,
    zones: &[(f64, f64)],
    properties: &FeatureProperties,
) {
    let offset_coordinates = offset_line(marking_coordinates, offset);
    if zones.is_empty() {
        features.push(RoadFeature {
            id: format!("{feature_prefix}-{suffix}"),
            kind,
            layer: layer + 1,
            geometry: Geometry::LineString(offset_coordinates),
            properties: FeatureProperties {
                render_width_feet: Some(0.5),
                ..properties.clone()
            },
        });
        return;
    }
    for (segment_index, (inside_zone, segment)) in
        split_line_by_zones(&offset_coordinates, zones).into_iter().enumerate()
    {
        if segment.len() < 2 {
            continue;
        }
        if !inside_zone {
            features.push(RoadFeature {
                id: format!("{feature_prefix}-{suffix}-{segment_index}"),
                kind: kind.clone(),
                layer: layer + 1,
                geometry: Geometry::LineString(segment),
                properties: FeatureProperties {
                    render_width_feet: Some(0.5),
                    ..properties.clone()
                },
            });
            continue;
        }
        for (dash_index, dash) in
            dashed_sub_segments(&segment, AUXILIARY_DASH_LENGTH_FEET, AUXILIARY_GAP_LENGTH_FEET)
                .into_iter()
                .enumerate()
        {
            features.push(RoadFeature {
                id: format!("{feature_prefix}-{suffix}-{segment_index}-dash-{dash_index}"),
                kind: RoadFeatureKind::AuxiliaryLaneLine,
                layer: layer + 1,
                geometry: Geometry::LineString(dash),
                properties: FeatureProperties {
                    render_width_feet: Some(0.5),
                    ..properties.clone()
                },
            });
        }
    }
}

/// Draws a shoulder edge, entirely omitting it wherever an adjoining ramp's zone reaches this
/// mainline way (the ramp's own pavement occupies that space instead).
fn append_shoulder_edge(
    features: &mut Vec<RoadFeature>,
    feature_prefix: &str,
    layer: i16,
    marking_coordinates: &[[f64; 2]],
    suffix: &str,
    offset: f64,
    width: f64,
    zones: &[(f64, f64)],
    properties: &FeatureProperties,
) {
    if width <= 0.0 {
        return;
    }
    let offset_coordinates = offset_line(marking_coordinates, offset);
    if zones.is_empty() {
        features.push(RoadFeature {
            id: format!("{feature_prefix}-{suffix}"),
            kind: RoadFeatureKind::ShoulderEdge,
            layer: layer + 1,
            geometry: Geometry::LineString(offset_coordinates),
            properties: FeatureProperties {
                render_width_feet: Some(0.75),
                ..properties.clone()
            },
        });
        return;
    }
    for (segment_index, (inside_zone, segment)) in
        split_line_by_zones(&offset_coordinates, zones).into_iter().enumerate()
    {
        if inside_zone || segment.len() < 2 {
            continue;
        }
        features.push(RoadFeature {
            id: format!("{feature_prefix}-{suffix}-{segment_index}"),
            kind: RoadFeatureKind::ShoulderEdge,
            layer: layer + 1,
            geometry: Geometry::LineString(segment),
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

fn inferred_layer(tags: &HashMap<String, String>) -> i16 {
    if let Some(layer) = tags.get("layer").and_then(|value| value.parse::<i16>().ok()) {
        return layer;
    }
    // OSM contributors frequently omit `layer` on bridges/tunnels since it is implied by convention.
    if tags.get("bridge").is_some_and(|value| value != "no") {
        return 1;
    }
    if tags.get("tunnel").is_some_and(|value| value != "no") {
        return -1;
    }
    0
}

fn cumulative_lengths(coordinates: &[[f64; 2]]) -> Vec<f64> {
    let mut cumulative = vec![0.0; coordinates.len()];
    for index in 1..coordinates.len() {
        let segment_length = (coordinates[index][0] - coordinates[index - 1][0])
            .hypot(coordinates[index][1] - coordinates[index - 1][1]);
        cumulative[index] = cumulative[index - 1] + segment_length;
    }
    cumulative
}

/// Builds a variable-width ribbon polygon that narrows to a point at gore ends, instead of the
/// constant-width stroke OSM's centerline-only data would otherwise force onto merging ramps.
fn tapered_ribbon_ring(
    coordinates: &[[f64; 2]],
    full_width: f64,
    taper_start: bool,
    taper_end: bool,
    taper_length: f64,
) -> Vec<[f64; 2]> {
    if coordinates.len() < 2 || full_width <= 0.0 {
        return Vec::new();
    }
    let cumulative = cumulative_lengths(coordinates);
    let total = *cumulative.last().unwrap_or(&0.0);
    let full_half_width = full_width / 2.0;
    let effective_taper_length = taper_length.min(total).max(1e-6);
    let half_widths: Vec<f64> = cumulative
        .iter()
        .map(|&distance_from_start| {
            let mut half = full_half_width;
            if taper_start {
                half = half.min(full_half_width * (distance_from_start / effective_taper_length).min(1.0));
            }
            if taper_end {
                let distance_from_end = total - distance_from_start;
                half = half.min(full_half_width * (distance_from_end / effective_taper_length).min(1.0));
            }
            half.max(0.0)
        })
        .collect();
    let mut left = Vec::with_capacity(coordinates.len());
    let mut right = Vec::with_capacity(coordinates.len());
    for (index, point) in coordinates.iter().enumerate() {
        let previous = coordinates[index.saturating_sub(1)];
        let next = coordinates[(index + 1).min(coordinates.len() - 1)];
        let delta_x = next[0] - previous[0];
        let delta_y = next[1] - previous[1];
        let length = delta_x.hypot(delta_y);
        let (normal_x, normal_y) = if length == 0.0 { (0.0, 0.0) } else { (-delta_y / length, delta_x / length) };
        let half = half_widths[index];
        left.push([point[0] - normal_x * half, point[1] - normal_y * half]);
        right.push([point[0] + normal_x * half, point[1] + normal_y * half]);
    }
    let mut ring = left;
    ring.extend(right.into_iter().rev());
    if let Some(first) = ring.first().copied() {
        ring.push(first);
    }
    ring
}

fn append_ramp_ribbon(
    features: &mut Vec<RoadFeature>,
    feature_prefix: &str,
    layer: i16,
    coordinates: &[[f64; 2]],
    width: f64,
    taper_start: bool,
    taper_end: bool,
    properties: &FeatureProperties,
) {
    let casing_ring = tapered_ribbon_ring(coordinates, width + 8.0, taper_start, taper_end, RAMP_GORE_LENGTH_FEET);
    if !casing_ring.is_empty() {
        features.push(RoadFeature {
            id: format!("{feature_prefix}-casing-ribbon"),
            kind: RoadFeatureKind::RampCasingRibbon,
            layer,
            geometry: Geometry::Polygon(vec![casing_ring]),
            properties: FeatureProperties { render_width_feet: Some(width + 8.0), ..properties.clone() },
        });
    }
    let surface_ring = tapered_ribbon_ring(coordinates, width, taper_start, taper_end, RAMP_GORE_LENGTH_FEET);
    if !surface_ring.is_empty() {
        features.push(RoadFeature {
            id: format!("{feature_prefix}-surface-ribbon"),
            kind: RoadFeatureKind::RampSurfaceRibbon,
            layer,
            geometry: Geometry::Polygon(vec![surface_ring]),
            properties: FeatureProperties { render_width_feet: Some(width), ..properties.clone() },
        });
    }
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
    let gore_length = length.min(RAMP_GORE_LENGTH_FEET);
    let base = [
        tip[0] + delta[0] / length * gore_length,
        tip[1] + delta[1] / length * gore_length,
    ];
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

fn trim_line_ends(
    coordinates: &[[f64; 2]],
    start_distance: f64,
    end_distance: f64,
) -> Vec<[f64; 2]> {
    fn trim_start(coordinates: &[[f64; 2]], mut distance: f64) -> Vec<[f64; 2]> {
        if distance <= 0.0 {
            return coordinates.to_vec();
        }
        for (index, segment) in coordinates.windows(2).enumerate() {
            let length =
                (segment[1][0] - segment[0][0]).hypot(segment[1][1] - segment[0][1]);
            if length > distance {
                let ratio = distance / length;
                let trimmed_start = [
                    segment[0][0] + (segment[1][0] - segment[0][0]) * ratio,
                    segment[0][1] + (segment[1][1] - segment[0][1]) * ratio,
                ];
                return std::iter::once(trimmed_start)
                    .chain(coordinates[index + 1..].iter().copied())
                    .collect();
            }
            distance -= length;
        }
        Vec::new()
    }

    let mut trimmed = trim_start(coordinates, start_distance);
    trimmed.reverse();
    trimmed = trim_start(&trimmed, end_distance);
    trimmed.reverse();
    trimmed
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

fn point_at_distance(coordinates: &[[f64; 2]], cumulative: &[f64], distance: f64) -> [f64; 2] {
    for index in 1..coordinates.len() {
        if cumulative[index] >= distance - 1e-9 {
            let segment_length = cumulative[index] - cumulative[index - 1];
            let ratio = if segment_length <= 0.0 {
                0.0
            } else {
                ((distance - cumulative[index - 1]) / segment_length).clamp(0.0, 1.0)
            };
            return [
                coordinates[index - 1][0] + (coordinates[index][0] - coordinates[index - 1][0]) * ratio,
                coordinates[index - 1][1] + (coordinates[index][1] - coordinates[index - 1][1]) * ratio,
            ];
        }
    }
    *coordinates.last().expect("coordinates has at least one point")
}

/// Splits a polyline at the given arc-length zone boundaries, tagging each resulting piece as
/// inside or outside one of the zones (e.g. an auxiliary-lane stretch alongside a ramp).
fn split_line_by_zones(coordinates: &[[f64; 2]], zones: &[(f64, f64)]) -> Vec<(bool, Vec<[f64; 2]>)> {
    if zones.is_empty() || coordinates.len() < 2 {
        return vec![(false, coordinates.to_vec())];
    }
    let cumulative = cumulative_lengths(coordinates);
    let total = *cumulative.last().unwrap_or(&0.0);
    let mut cut_points: Vec<f64> = zones
        .iter()
        .flat_map(|&(start, end)| [start.clamp(0.0, total), end.clamp(0.0, total)])
        .collect();
    cut_points.push(0.0);
    cut_points.push(total);
    cut_points.sort_by(f64::total_cmp);
    cut_points.dedup_by(|first, second| (*first - *second).abs() < 1e-6);

    let mut segments = Vec::new();
    for window in cut_points.windows(2) {
        let (start, end) = (window[0], window[1]);
        if end - start < 1e-6 {
            continue;
        }
        let midpoint = (start + end) / 2.0;
        let inside_zone = zones.iter().any(|&(zone_start, zone_end)| midpoint >= zone_start && midpoint <= zone_end);
        let mut points = vec![point_at_distance(coordinates, &cumulative, start)];
        for (index, &distance) in cumulative.iter().enumerate() {
            if distance > start + 1e-6 && distance < end - 1e-6 {
                points.push(coordinates[index]);
            }
        }
        points.push(point_at_distance(coordinates, &cumulative, end));
        segments.push((inside_zone, points));
    }
    segments
}

/// VDOT's dotted lane line for the boundary of an auxiliary lane: a 3 ft stripe with a 9 ft gap.
const AUXILIARY_DASH_LENGTH_FEET: f64 = 3.0;
const AUXILIARY_GAP_LENGTH_FEET: f64 = 9.0;

fn dashed_sub_segments(coordinates: &[[f64; 2]], dash_length: f64, gap_length: f64) -> Vec<Vec<[f64; 2]>> {
    if coordinates.len() < 2 {
        return Vec::new();
    }
    let cumulative = cumulative_lengths(coordinates);
    let total = *cumulative.last().unwrap_or(&0.0);
    let mut segments = Vec::new();
    let mut position = 0.0;
    while position < total - 1e-6 {
        let dash_end = (position + dash_length).min(total);
        segments.push(vec![
            point_at_distance(coordinates, &cumulative, position),
            point_at_distance(coordinates, &cumulative, dash_end),
        ]);
        position = dash_end + gap_length;
    }
    segments
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
        let points = match &mut feature.geometry {
            Geometry::LineString(points) => points.iter_mut().collect::<Vec<_>>(),
            Geometry::Polygon(rings) => rings.iter_mut().flatten().collect(),
        };
        for point in points {
            point[0] = point[0] - minimum_x + padding;
            point[1] = point[1] - minimum_y + padding;
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
    fn mainline_edge_point_offsets_toward_the_ramp_instead_of_the_centerline() {
        // Mainline runs due "north" (increasing y); the ramp approaches from the +x side.
        let anchor = MainlineAnchor { tangent: [0.0, 1.0], half_width: 25.0 };
        let junction_node = [100.0, 200.0];
        let ramp_adjacent_point = [130.0, 190.0];

        let edge_point = mainline_edge_point(junction_node, ramp_adjacent_point, &anchor);

        assert!((edge_point[0] - 125.0).abs() < 1e-9);
        assert!((edge_point[1] - 200.0).abs() < 1e-9);
    }

    #[test]
    fn chains_an_entrance_zone_to_the_next_exit_on_the_same_side() {
        let noses = vec![
            RampNose { arc_position: 500.0, kind: RampNoseKind::Entrance, side_sign: 1.0 },
            RampNose { arc_position: 900.0, kind: RampNoseKind::Exit, side_sign: 1.0 },
        ];

        let zones = compute_marking_zones(&noses, 2_000.0);

        assert_eq!(zones.len(), 1);
        assert_eq!(zones[0].start, 500.0);
        assert_eq!(zones[0].end, 900.0);
    }

    #[test]
    fn falls_back_to_a_fixed_taper_zone_for_an_isolated_entrance() {
        let noses = vec![RampNose { arc_position: 500.0, kind: RampNoseKind::Entrance, side_sign: 1.0 }];

        let zones = compute_marking_zones(&noses, 2_000.0);

        assert_eq!(zones.len(), 1);
        assert_eq!(zones[0].start, 500.0);
        assert_eq!(zones[0].end, 500.0 + RAMP_GORE_LENGTH_FEET);
    }

    #[test]
    fn falls_back_to_a_fixed_taper_zone_for_an_isolated_exit() {
        let noses = vec![RampNose { arc_position: 500.0, kind: RampNoseKind::Exit, side_sign: -1.0 }];

        let zones = compute_marking_zones(&noses, 2_000.0);

        assert_eq!(zones.len(), 1);
        assert_eq!(zones[0].start, 500.0 - RAMP_GORE_LENGTH_FEET);
        assert_eq!(zones[0].end, 500.0);
    }

    #[test]
    fn does_not_chain_zones_on_opposite_sides_of_the_mainline() {
        let noses = vec![
            RampNose { arc_position: 500.0, kind: RampNoseKind::Entrance, side_sign: 1.0 },
            RampNose { arc_position: 900.0, kind: RampNoseKind::Exit, side_sign: -1.0 },
        ];

        let zones = compute_marking_zones(&noses, 2_000.0);

        assert_eq!(zones.len(), 2);
        assert!(zones.iter().any(|zone| zone.side_sign == 1.0 && zone.end == 500.0 + RAMP_GORE_LENGTH_FEET));
        assert!(zones.iter().any(|zone| zone.side_sign == -1.0 && zone.start == 900.0 - RAMP_GORE_LENGTH_FEET));
    }

    #[test]
    fn splits_a_line_into_solid_pieces_outside_a_zone_and_tags_the_middle_piece() {
        let line = vec![[0.0, 0.0], [100.0, 0.0]];

        let segments = split_line_by_zones(&line, &[(30.0, 60.0)]);

        assert_eq!(segments.len(), 3);
        assert!(!segments[0].0);
        assert!(segments[1].0);
        assert!(!segments[2].0);
        assert!((segments[0].1.last().unwrap()[0] - 30.0).abs() < 1e-9);
        assert!((segments[1].1.first().unwrap()[0] - 30.0).abs() < 1e-9);
        assert!((segments[1].1.last().unwrap()[0] - 60.0).abs() < 1e-9);
        assert!((segments[2].1.first().unwrap()[0] - 60.0).abs() < 1e-9);
    }

    #[test]
    fn dashes_a_segment_using_the_virginia_3ft_dash_9ft_gap_pattern() {
        let line = vec![[0.0, 0.0], [24.0, 0.0]];

        let dashes = dashed_sub_segments(&line, AUXILIARY_DASH_LENGTH_FEET, AUXILIARY_GAP_LENGTH_FEET);

        // 24 ft / (3 ft dash + 9 ft gap = 12 ft period) starts 2 dashes within the segment.
        assert_eq!(dashes.len(), 2);
        for dash in &dashes {
            let length = (dash[1][0] - dash[0][0]).hypot(dash[1][1] - dash[0][1]);
            assert!(length <= AUXILIARY_DASH_LENGTH_FEET + 1e-6);
        }
    }

    #[test]
    fn chained_entrance_and_exit_ramps_mark_a_continuous_auxiliary_lane() {
        let response = r#"{
          "elements": [
            {"type":"node","id":1,"lat":38.8000,"lon":-77.2000,"tags":{"highway":"motorway_junction","ref":"166"}},
            {"type":"node","id":2,"lat":38.7950,"lon":-77.2000},
            {"type":"node","id":3,"lat":38.8020,"lon":-77.2000,"tags":{"highway":"motorway_junction","ref":"167"}},
            {"type":"node","id":4,"lat":38.8060,"lon":-77.2000},
            {"type":"node","id":5,"lat":38.8005,"lon":-77.1990},
            {"type":"node","id":6,"lat":38.8015,"lon":-77.1990},
            {"type":"way","id":95,"nodes":[2,1,3,4],"tags":{"highway":"motorway","ref":"I 95","lanes":"3","oneway":"yes"}},
            {"type":"way","id":96,"nodes":[1,5],"tags":{"highway":"motorway_link","lanes":"1","oneway":"yes"}},
            {"type":"way","id":97,"nodes":[3,6],"tags":{"highway":"motorway_link","lanes":"1","oneway":"yes"}}
          ]
        }"#;
        let request = RoadLocationRequest {
            highway: "I-95".into(),
            direction: TravelDirection::Northbound,
            reference_type: RoadReferenceType::Exit,
            reference: "166".into(),
        };

        let scene = compile_overpass_json(response, &request).expect("scene should compile");

        // Both ramps merge/diverge on the same (right) side, so the whole stretch between them
        // reads as one continuous auxiliary lane: a single gap in the shoulder edge, not two, and
        // dashed fog line the entire way instead of reverting solid in between.
        assert!(!scene.features.iter().any(|feature| feature.id.contains("right-shoulder-edge-1")));
        assert!(scene.features.iter().any(|feature| feature.id == "way-95-0-right-shoulder-edge-0"));
        assert!(scene.features.iter().any(|feature| feature.id == "way-95-0-right-shoulder-edge-2"));
        assert!(scene.features.iter().filter(|feature| feature.kind == RoadFeatureKind::AuxiliaryLaneLine).count() > 0);
        assert!(scene.features.iter().any(|feature| feature.id == "way-95-0-right-edge-0"));
        assert!(scene.features.iter().any(|feature| feature.id == "way-95-0-right-edge-2"));
        assert!(!scene.features.iter().any(|feature| feature.id == "way-95-0-right-edge-1"));
    }

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
        // The on-ramp is isolated (no nearby off-ramp), so the mainline's right fog line/shoulder
        // edge only carry an auxiliary-lane zone for the standard merge-taper distance: the right
        // fog line splits solid/dashed/solid, and the right shoulder edge gets a gap in between.
        assert_eq!(scene.features.len(), 24);
        assert_eq!(scene.features[1].properties.osm_id, Some(95));
        assert_eq!(scene.features[1].properties.render_width_feet, Some(50.0));
        assert_eq!(scene.features.iter().filter(|feature| feature.kind == RoadFeatureKind::SkipLine).count(), 2);
        assert_eq!(scene.features.iter().filter(|feature| matches!(feature.kind, RoadFeatureKind::LeftFogLine | RoadFeatureKind::RightFogLine)).count(), 5);
        assert_eq!(scene.features.iter().filter(|feature| feature.kind == RoadFeatureKind::AuxiliaryLaneLine).count(), 6);
        assert_eq!(scene.features.iter().filter(|feature| feature.kind == RoadFeatureKind::ShoulderEdge).count(), 3);
        assert!(scene.features.iter().any(|feature| feature.id == "way-95-0-right-shoulder-edge-0"));
        assert!(scene.features.iter().any(|feature| feature.id == "way-95-0-right-shoulder-edge-2"));
        assert!(!scene.features.iter().any(|feature| feature.id.contains("right-shoulder-edge-1")));
        assert_eq!(scene.features.iter().filter(|feature| feature.kind == RoadFeatureKind::RampGore).count(), 1);
        assert_eq!(scene.features.iter().filter(|feature| feature.kind == RoadFeatureKind::DirectionArrow).count(), 1);
        assert_eq!(scene.features.iter().filter(|feature| feature.kind == RoadFeatureKind::RampCasingRibbon).count(), 1);
        assert_eq!(scene.features.iter().filter(|feature| feature.kind == RoadFeatureKind::RampSurfaceRibbon).count(), 1);
        let ramp_surface = scene
            .features
            .iter()
            .find(|feature| feature.id == "way-96-0-surface")
            .expect("ramp surface");
        // The ramp centerline stays for section selection, but its pavement no longer renders at
        // a constant width — the tapered ribbon below draws the visible merge instead.
        assert_eq!(ramp_surface.properties.render_width_feet, Some(0.0));
        let ramp_fog_line = scene
            .features
            .iter()
            .find(|feature| feature.id == "way-96-0-left-edge")
            .expect("ramp fog line");
        let gore = scene
            .features
            .iter()
            .find(|feature| feature.kind == RoadFeatureKind::RampGore)
            .expect("ramp gore");
        let ramp_surface_ribbon = scene
            .features
            .iter()
            .find(|feature| feature.id == "way-96-0-surface-ribbon")
            .expect("ramp surface ribbon");
        let Geometry::LineString(surface_points) = &ramp_surface.geometry else {
            panic!("ramp surface should be a line")
        };
        let Geometry::LineString(fog_points) = &ramp_fog_line.geometry else {
            panic!("fog line should be a line")
        };
        let Geometry::Polygon(gore_rings) = &gore.geometry else {
            panic!("gore should be a polygon")
        };
        let Geometry::Polygon(ribbon_rings) = &ramp_surface_ribbon.geometry else {
            panic!("ramp surface ribbon should be a polygon")
        };
        assert!(
            (fog_points[0][0] - surface_points[0][0])
                .hypot(fog_points[0][1] - surface_points[0][1])
                > 60.0
        );
        // The ribbon narrows to a point at the mainline's pavement edge — offset from the shared
        // OSM junction node by the mainline's own half-width (50 ft wide / 2 = 25 ft) — instead of
        // continuing at full pavement width all the way to the mainline's centerline.
        let ribbon_ring = &ribbon_rings[0];
        let tip_offset_from_junction_node =
            (ribbon_ring[0][0] - surface_points[0][0]).hypot(ribbon_ring[0][1] - surface_points[0][1]);
        assert!(
            (tip_offset_from_junction_node - 25.0).abs() < 0.5,
            "expected the ribbon tip ~25 ft from the junction node, got {tip_offset_from_junction_node}"
        );
        let farthest_offset_from_tip = ribbon_ring
            .iter()
            .map(|point| (point[0] - surface_points[0][0]).hypot(point[1] - surface_points[0][1]))
            .fold(0.0_f64, f64::max);
        assert!(farthest_offset_from_tip > 60.0);
        let offsets_from_far_end = ribbon_ring
            .iter()
            .map(|point| (point[0] - surface_points[1][0]).hypot(point[1] - surface_points[1][1]))
            .fold(f64::INFINITY, f64::min);
        assert!(offsets_from_far_end < 6.5);
        assert!(
            gore_rings
                .iter()
                .flatten()
                .all(|point| point[0] >= 0.0 && point[1] >= 0.0)
        );
        assert!(scene.viewport.height > 700.0);
    }

        #[test]
        fn estimates_an_unmapped_mile_marker_from_route_geometry() {
                let response = r#"{
                    "elements": [
                        {"type":"node","id":1,"lat":38.7900,"lon":-77.1000},
                        {"type":"node","id":2,"lat":38.7972,"lon":-77.1000},
                        {"type":"node","id":3,"lat":38.8044,"lon":-77.1000},
                        {"type":"way","id":395,"nodes":[1,2,3],"tags":{"highway":"motorway","ref":"I 395","lanes":"3","oneway":"yes"}}
                    ]
                }"#;
                let request = RoadLocationRequest {
                        highway: "I-395".into(),
                        direction: TravelDirection::Southbound,
                        reference_type: RoadReferenceType::MileMarker,
                        reference: "0.5".into(),
                };

                let scene = compile_overpass_json(response, &request).expect("route geometry should locate the mile point");

                assert_eq!(scene.source.source_type, SceneSourceType::OsmApi);
                assert!(scene.features.iter().any(|feature| feature.properties.osm_id == Some(395)));
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
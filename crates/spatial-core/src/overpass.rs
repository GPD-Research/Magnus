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
const TERMINAL_INTERSECTION_SEARCH_FEET: f64 = 240.0;

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

/// A distance to trim from the start and/or end of one specific marking line (0.0 = no trim),
/// applied to that line's own offset geometry rather than the shared centerline, so a ramp's fog
/// line and shoulder edge on the same side can stop at different points near a gore.
#[derive(Debug, Clone, Copy, Default)]
struct EdgeTrim {
    start: f64,
    end: f64,
}

struct LaneMarkingLayout<'a> {
    lanes: u16,
    left_shoulder_width: f64,
    right_shoulder_width: f64,
    left_fog_trim: EdgeTrim,
    right_fog_trim: EdgeTrim,
    left_shoulder_trim: EdgeTrim,
    right_shoulder_trim: EdgeTrim,
    /// Arc-length ranges (mainline ways only) where an adjoining ramp turns the edge markings
    /// into an auxiliary-lane treatment instead of a continuous solid edge. Empty for ramps.
    left_fog_zones: &'a [(f64, f64)],
    right_fog_zones: &'a [(f64, f64)],
    left_shoulder_zones: &'a [(f64, f64)],
    right_shoulder_zones: &'a [(f64, f64)],
}

/// The mainline's own tangent direction and half-width at a junction node, used to find where its
/// pavement edge (not its centerline, which is where OSM actually joins the ramp) really is.
struct MainlineAnchor {
    tangent: [f64; 2],
    /// Half-width of the travel lanes only (no shoulder) — where the mainline's own fog line is.
    fog_half_width: f64,
    /// Half-width of the travel lanes plus shoulder — where the mainline's pavement actually ends.
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
        let fog_half_width = f64::from(lanes) * LANE_WIDTH_FEET / 2.0;
        let half_width = fog_half_width + (left_shoulder_width + right_shoulder_width) / 2.0;
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
                fog_half_width,
                half_width,
            });
        }
    }
    anchors
}

/// The point on the mainline's pavement edge (nearest the ramp) below a shared junction node,
/// instead of the node itself, which OSM places on the mainline's centerline. Used only as a
/// fallback when the precise ramp/mainline line-intersection geometry is degenerate.
fn mainline_edge_point(node: [f64; 2], half_width: f64, sign: f64, anchor: &MainlineAnchor) -> [f64; 2] {
    let perpendicular = [-anchor.tangent[1], anchor.tangent[0]];
    [
        node[0] + perpendicular[0] * half_width * sign,
        node[1] + perpendicular[1] * half_width * sign,
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

/// The precise geometry of a single ramp/mainline junction: exactly where the ramp's own fog line
/// would cross the mainline's fog line (the theoretical gore nose, `tip`), and exactly where their
/// outer shoulder edges would cross (`base`, where the two roadways' pavement fully separates) —
/// instead of approximating both as one fixed distance from the shared OSM node.
struct GoreGeometry {
    tip: [f64; 2],
    base: [f64; 2],
    /// Where the ramp's own fog line, and the mainline's own fog line, each are at the "base"
    /// (shoulder-edge-crossing) distance — the two other corners of the gore stripe polygon.
    ramp_fog_at_base: [f64; 2],
    mainline_fog_at_base: [f64; 2],
    /// Distance back from the junction node, along the ramp's own centerline, to `tip`/`base`.
    ramp_trim_to_tip: f64,
    ramp_trim_to_base: f64,
    /// Signed arc-length offset from the junction node, along the mainline's own centerline, to
    /// `tip`/`base` (positive = downstream, negative = upstream).
    mainline_arc_to_tip: f64,
    mainline_arc_to_base: f64,
    /// +1.0 if the mainline lies on the ramp's own "right" offset side, -1.0 for "left" — i.e.
    /// which of the ramp's own fog-line/shoulder-edge markings needs to be trimmed at all.
    near_side_sign: f64,
}

fn line_intersection(
    point_a: [f64; 2],
    direction_a: [f64; 2],
    point_b: [f64; 2],
    direction_b: [f64; 2],
) -> Option<(f64, f64)> {
    let denominator = direction_a[0] * direction_b[1] - direction_a[1] * direction_b[0];
    if denominator.abs() < 1e-9 {
        return None;
    }
    let delta = [point_b[0] - point_a[0], point_b[1] - point_a[1]];
    let t = (delta[0] * direction_b[1] - delta[1] * direction_b[0]) / denominator;
    let s = (delta[0] * direction_a[1] - delta[1] * direction_a[0]) / denominator;
    Some((t, s))
}

/// Computes the precise gore geometry for one ramp end, given the shared junction node, a point
/// further into the ramp (used both to orient the ramp's own tangent and, via `mainline_side_sign`,
/// to know which side of the mainline the ramp approaches from), and the ramp's own lane/shoulder
/// widths. Returns `None` for degenerate junctions (near-parallel approach, or an intersection that
/// falls the wrong way along the ramp), which the caller falls back to a fixed-distance estimate for.
fn compute_gore_geometry(
    node: [f64; 2],
    ramp_adjacent: [f64; 2],
    ramp_lanes: u16,
    ramp_left_shoulder_width: f64,
    ramp_right_shoulder_width: f64,
    mainline_anchor: &MainlineAnchor,
) -> Option<GoreGeometry> {
    let delta = [ramp_adjacent[0] - node[0], ramp_adjacent[1] - node[1]];
    let length = delta[0].hypot(delta[1]);
    if length == 0.0 {
        return None;
    }
    // Points away from the node, back into the ramp's own body.
    let ramp_tangent = [delta[0] / length, delta[1] / length];
    let ramp_perp = [-ramp_tangent[1], ramp_tangent[0]];
    let mainline_perp = [-mainline_anchor.tangent[1], mainline_anchor.tangent[0]];
    let mainline_side_sign = mainline_side_sign(node, ramp_adjacent, mainline_anchor);
    let alignment = ramp_tangent[0] * mainline_anchor.tangent[0] + ramp_tangent[1] * mainline_anchor.tangent[1];
    let near_side_sign = if alignment >= 0.0 { mainline_side_sign } else { -mainline_side_sign };
    let ramp_fog_half_width = f64::from(ramp_lanes) * LANE_WIDTH_FEET / 2.0;
    let ramp_near_shoulder_width = if near_side_sign < 0.0 { ramp_left_shoulder_width } else { ramp_right_shoulder_width };
    let ramp_shoulder_half_width = ramp_fog_half_width + ramp_near_shoulder_width;

    let offset_point = |base: [f64; 2], perpendicular: [f64; 2], half_width: f64, sign: f64| {
        [base[0] + perpendicular[0] * half_width * sign, base[1] + perpendicular[1] * half_width * sign]
    };

    let ramp_fog_origin = offset_point(node, ramp_perp, ramp_fog_half_width, near_side_sign);
    let mainline_fog_origin = offset_point(node, mainline_perp, mainline_anchor.fog_half_width, mainline_side_sign);
    let (ramp_t_tip, mainline_s_tip) =
        line_intersection(ramp_fog_origin, ramp_tangent, mainline_fog_origin, mainline_anchor.tangent)?;

    let ramp_shoulder_origin = offset_point(node, ramp_perp, ramp_shoulder_half_width, near_side_sign);
    let mainline_shoulder_origin = offset_point(node, mainline_perp, mainline_anchor.half_width, mainline_side_sign);
    let (ramp_t_base, mainline_s_base) =
        line_intersection(ramp_shoulder_origin, ramp_tangent, mainline_shoulder_origin, mainline_anchor.tangent)?;

    if ramp_t_tip <= 0.0 || ramp_t_base <= ramp_t_tip {
        return None;
    }

    Some(GoreGeometry {
        tip: [
            ramp_fog_origin[0] + ramp_tangent[0] * ramp_t_tip,
            ramp_fog_origin[1] + ramp_tangent[1] * ramp_t_tip,
        ],
        base: [
            ramp_shoulder_origin[0] + ramp_tangent[0] * ramp_t_base,
            ramp_shoulder_origin[1] + ramp_tangent[1] * ramp_t_base,
        ],
        ramp_fog_at_base: [
            ramp_fog_origin[0] + ramp_tangent[0] * ramp_t_base,
            ramp_fog_origin[1] + ramp_tangent[1] * ramp_t_base,
        ],
        mainline_fog_at_base: [
            mainline_fog_origin[0] + mainline_anchor.tangent[0] * mainline_s_base,
            mainline_fog_origin[1] + mainline_anchor.tangent[1] * mainline_s_base,
        ],
        ramp_trim_to_tip: ramp_t_tip,
        ramp_trim_to_base: ramp_t_base,
        mainline_arc_to_tip: mainline_s_tip,
        mainline_arc_to_base: mainline_s_base,
        near_side_sign,
    })
}

/// `compute_gore_geometry`, but falls back to the mainline's fog-line/shoulder-edge offsets from
/// the node directly (ignoring the ramp's own angle of approach) when the precise intersection is
/// degenerate, so a gore end is never simply skipped.
fn gore_geometry_for_end(
    node: [f64; 2],
    ramp_adjacent: [f64; 2],
    ramp_lanes: u16,
    ramp_left_shoulder_width: f64,
    ramp_right_shoulder_width: f64,
    mainline_anchor: &MainlineAnchor,
) -> GoreGeometry {
    compute_gore_geometry(
        node,
        ramp_adjacent,
        ramp_lanes,
        ramp_left_shoulder_width,
        ramp_right_shoulder_width,
        mainline_anchor,
    )
    .unwrap_or_else(|| {
        let sign = mainline_side_sign(node, ramp_adjacent, mainline_anchor);
        let base = mainline_edge_point(node, mainline_anchor.half_width, sign, mainline_anchor);
        GoreGeometry {
            tip: mainline_edge_point(node, mainline_anchor.fog_half_width, sign, mainline_anchor),
            base,
            ramp_fog_at_base: base,
            mainline_fog_at_base: base,
            ramp_trim_to_tip: RAMP_GORE_LENGTH_FEET,
            ramp_trim_to_base: RAMP_GORE_LENGTH_FEET,
            mainline_arc_to_tip: 0.0,
            mainline_arc_to_base: RAMP_GORE_LENGTH_FEET,
            near_side_sign: sign,
        }
    })
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
    /// Mainline arc position where the ramp's own fog line crosses the mainline's fog line.
    fog_arc: f64,
    /// Mainline arc position where the ramp's own shoulder edge crosses the mainline's shoulder edge.
    shoulder_arc: f64,
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
        let highway = way.tags.get("highway").cloned().unwrap_or_default();
        if !highway.ends_with("_link") {
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
        let lanes = way
            .tags
            .get("lanes")
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(1);
        let (left_shoulder_width, right_shoulder_width) = shoulder_widths(&way.tags, &highway);
        let mut add_nose = |node_id: i64, adjacent_point: [f64; 2], node_point: [f64; 2], kind: RampNoseKind| {
            let Some(mainline_anchor) = mainline_anchors.get(&node_id) else { return };
            let side_sign = mainline_side_sign(node_point, adjacent_point, mainline_anchor);
            let gore =
                gore_geometry_for_end(node_point, adjacent_point, lanes, left_shoulder_width, right_shoulder_width, mainline_anchor);
            for (mainline_way_id, profile) in mainline_profiles {
                if let Some(&node_arc) = profile.node_arc.get(&node_id) {
                    noses.entry(*mainline_way_id).or_default().push(RampNose {
                        fog_arc: node_arc + gore.mainline_arc_to_tip,
                        shoulder_arc: node_arc + gore.mainline_arc_to_base,
                        kind,
                        side_sign,
                    });
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
        way_noses.sort_by(|first, second| first.fog_arc.total_cmp(&second.fog_arc));
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

/// Whether a mainline zone boundary follows a ramp's fog-line crossing (for the mainline's own fog
/// line) or its shoulder-edge crossing (for the mainline's own shoulder edge) — the two lines meet
/// the mainline at different points, so they need different zone extents.
#[derive(Clone, Copy)]
enum ZoneReference {
    FogLine,
    ShoulderEdge,
}

/// Real interchanges mark the stretch between a merge and the next, nearby diverge as a
/// continuous auxiliary lane (a dashed interior line, not a solid edge) instead of two separate
/// short acceleration/deceleration zones, so a chained entrance->exit pair shares one zone.
fn compute_marking_zones(noses: &[RampNose], total_length: f64, reference: ZoneReference) -> Vec<MarkingZone> {
    let arc = |nose: &RampNose| match reference {
        ZoneReference::FogLine => nose.fog_arc,
        ZoneReference::ShoulderEdge => nose.shoulder_arc,
    };
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
                zones.push(MarkingZone { start: arc(nose), end: arc(exit_nose), side_sign: nose.side_sign });
            }
            None => zones.push(MarkingZone {
                start: arc(nose),
                end: (arc(nose) + RAMP_GORE_LENGTH_FEET).min(total_length),
                side_sign: nose.side_sign,
            }),
        }
    }
    for (index, nose) in noses.iter().enumerate() {
        if nose.kind != RampNoseKind::Exit || chained_exit_indices.contains(&index) {
            continue;
        }
        zones.push(MarkingZone {
            start: (arc(nose) - RAMP_GORE_LENGTH_FEET).max(0.0),
            end: arc(nose),
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
    let mainline_fog_zones: HashMap<i64, Vec<MarkingZone>> = mainline_profiles
        .iter()
        .map(|(way_id, profile)| {
            let zones = ramp_noses
                .get(way_id)
                .map(|noses| compute_marking_zones(noses, profile.total_length, ZoneReference::FogLine))
                .unwrap_or_default();
            (*way_id, zones)
        })
        .collect();
    let mainline_shoulder_zones: HashMap<i64, Vec<MarkingZone>> = mainline_profiles
        .iter()
        .map(|(way_id, profile)| {
            let zones = ramp_noses
                .get(way_id)
                .map(|noses| compute_marking_zones(noses, profile.total_length, ZoneReference::ShoulderEdge))
                .unwrap_or_default();
            (*way_id, zones)
        })
        .collect();
    let way_paths = ways
        .iter()
        .filter_map(|way| {
            let coordinates = way
                .nodes
                .iter()
                .filter_map(|node_id| nodes.get(node_id))
                .map(|node| oriented_local_feet(node, &anchor, &request.direction))
                .collect::<Vec<_>>();
            (coordinates.len() >= 2).then_some((
                way.id,
                coordinates,
                inferred_layer(&way.tags),
                way.tags.get("bridge").is_some_and(|value| value != "no"),
                way.tags.get("tunnel").is_some_and(|value| value != "no"),
                way.tags
                    .get("highway")
                    .is_some_and(|highway| highway.ends_with("_link")),
            ))
        })
        .collect::<Vec<_>>();

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
        let highway = way.tags.get("highway").cloned().unwrap_or_default();
        let lanes = way
            .tags
            .get("lanes")
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or_else(|| if highway.ends_with("_link") { 1 } else { 2 });
        let (left_shoulder_width, right_shoulder_width) = shoulder_widths(&way.tags, &highway);
        let mut start_gore = is_link
            .then(|| {
                let node_point = *coordinates.first()?;
                let adjacent_point = *coordinates.get(1)?;
                let mainline_anchor = mainline_anchors.get(way.nodes.first()?)?;
                Some(gore_geometry_for_end(node_point, adjacent_point, lanes, left_shoulder_width, right_shoulder_width, mainline_anchor))
            })
            .flatten();
        let mut end_gore = is_link
            .then(|| {
                let last_index = coordinates.len().checked_sub(1)?;
                let node_point = *coordinates.get(last_index)?;
                let adjacent_point = *coordinates.get(last_index.checked_sub(1)?)?;
                let mainline_anchor = mainline_anchors.get(way.nodes.last()?)?;
                Some(gore_geometry_for_end(node_point, adjacent_point, lanes, left_shoulder_width, right_shoulder_width, mainline_anchor))
            })
            .flatten();
        let mut start_has_gore = start_gore.is_some();
        let mut end_has_gore = end_gore.is_some();
        if way.tags.get("oneway").is_some_and(|value| value == "-1") {
            coordinates.reverse();
            std::mem::swap(&mut start_has_gore, &mut end_has_gore);
            std::mem::swap(&mut start_gore, &mut end_gore);
            for gore in start_gore.iter_mut().chain(end_gore.iter_mut()) {
                gore.near_side_sign = -gore.near_side_sign;
            }
        }
        let (intersection_trim_start, intersection_trim_end) = is_link
            .then(|| ramp_intersection_trims(way.id, &coordinates, &way_paths))
            .unwrap_or_default();
        coordinates = trim_line_ends(&coordinates, intersection_trim_start, intersection_trim_end);
        if coordinates.len() < 2 {
            continue;
        }
        let fragments = clip_line_to_scene(&coordinates, scene_bounds);
        if fragments.is_empty() {
            continue;
        }
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
        let zone_ranges = |zones: Option<&Vec<MarkingZone>>| -> (Vec<(f64, f64)>, Vec<(f64, f64)>) {
            zones
                .map(|zones| {
                    let left = zones.iter().filter(|zone| zone.side_sign < 0.0).map(|zone| (zone.start, zone.end)).collect();
                    let right = zones.iter().filter(|zone| zone.side_sign > 0.0).map(|zone| (zone.start, zone.end)).collect();
                    (left, right)
                })
                .unwrap_or_default()
        };
        let (left_fog_zone_ranges, right_fog_zone_ranges) = zone_ranges(mainline_fog_zones.get(&way.id));
        let (left_shoulder_zone_ranges, right_shoulder_zone_ranges) = zone_ranges(mainline_shoulder_zones.get(&way.id));
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
                    render_width_feet: Some(if is_link { 0.0 } else { width + 8.0 }),
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
                    if let Some(gore) = &start_gore {
                        visual_coordinates[0] = gore.base;
                    }
                }
                if trim_marking_end {
                    if let Some(gore) = &end_gore {
                        let last_index = visual_coordinates.len() - 1;
                        visual_coordinates[last_index] = gore.base;
                    }
                }
                append_ramp_ribbon(
                    &mut features,
                    &fragment_id,
                    layer,
                    &visual_coordinates,
                    width,
                    start_gore.as_ref().filter(|_| trim_marking_start).map_or(0.0, |gore| gore.ramp_trim_to_base),
                    end_gore.as_ref().filter(|_| trim_marking_end).map_or(0.0, |gore| gore.ramp_trim_to_base),
                    &properties,
                );
                append_direction_arrow(&mut features, &fragment_id, layer, &visual_coordinates, &properties);
                if trim_marking_start {
                    if let Some(gore) = &start_gore {
                        append_ramp_gore(&mut features, &fragment_id, layer, gore, true, &properties);
                    }
                }
                if trim_marking_end {
                    if let Some(gore) = &end_gore {
                        append_ramp_gore(&mut features, &fragment_id, layer, gore, false, &properties);
                    }
                }
            }
            let mut left_fog_trim = EdgeTrim::default();
            let mut right_fog_trim = EdgeTrim::default();
            let mut left_shoulder_trim = EdgeTrim::default();
            let mut right_shoulder_trim = EdgeTrim::default();
            if let Some(gore) = start_gore.as_ref().filter(|_| trim_marking_start) {
                left_fog_trim.start = gore.ramp_trim_to_tip.max(intersection_trim_start);
                right_fog_trim.start = gore.ramp_trim_to_tip.max(intersection_trim_start);
                if gore.near_side_sign < 0.0 {
                    left_shoulder_trim.start = gore.ramp_trim_to_base;
                } else {
                    right_shoulder_trim.start = gore.ramp_trim_to_base;
                }
            }
            if let Some(gore) = end_gore.as_ref().filter(|_| trim_marking_end) {
                left_fog_trim.end = gore.ramp_trim_to_tip.max(intersection_trim_end);
                right_fog_trim.end = gore.ramp_trim_to_tip.max(intersection_trim_end);
                if gore.near_side_sign < 0.0 {
                    left_shoulder_trim.end = gore.ramp_trim_to_base;
                } else {
                    right_shoulder_trim.end = gore.ramp_trim_to_base;
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
                    left_fog_trim,
                    right_fog_trim,
                    left_shoulder_trim,
                    right_shoulder_trim,
                    left_fog_zones: if fragment_index == 0 { &left_fog_zone_ranges } else { &no_zones },
                    right_fog_zones: if fragment_index == 0 { &right_fog_zone_ranges } else { &no_zones },
                    left_shoulder_zones: if fragment_index == 0 { &left_shoulder_zone_ranges } else { &no_zones },
                    right_shoulder_zones: if fragment_index == 0 { &right_shoulder_zone_ranges } else { &no_zones },
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
    if coordinates.len() < 2 {
        return;
    }
    let half_width = f64::from(layout.lanes) * LANE_WIDTH_FEET / 2.0;
    append_edge_line(
        features,
        feature_prefix,
        layer,
        coordinates,
        "left-edge",
        RoadFeatureKind::LeftFogLine,
        -half_width + EDGE_LINE_INSET_FEET,
        layout.left_fog_trim,
        layout.left_fog_zones,
        properties,
    );
    append_edge_line(
        features,
        feature_prefix,
        layer,
        coordinates,
        "right-edge",
        RoadFeatureKind::RightFogLine,
        half_width - EDGE_LINE_INSET_FEET,
        layout.right_fog_trim,
        layout.right_fog_zones,
        properties,
    );
    for lane in 1..layout.lanes {
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
    append_shoulder_edge(
        features,
        feature_prefix,
        layer,
        coordinates,
        "left-shoulder-edge",
        -half_width - layout.left_shoulder_width,
        layout.left_shoulder_width,
        layout.left_shoulder_trim,
        layout.left_shoulder_zones,
        properties,
    );
    append_shoulder_edge(
        features,
        feature_prefix,
        layer,
        coordinates,
        "right-shoulder-edge",
        half_width + layout.right_shoulder_width,
        layout.right_shoulder_width,
        layout.right_shoulder_trim,
        layout.right_shoulder_zones,
        properties,
    );
}

/// Draws a fog line, trimming it back from either end (e.g. where a ramp's own fog line meets the
/// mainline's) and, on a mainline way with a nearby ramp, splitting the affected stretch into
/// VDOT's dotted auxiliary-lane pattern (3 ft dash / 9 ft gap) instead of a continuous solid line.
fn append_edge_line(
    features: &mut Vec<RoadFeature>,
    feature_prefix: &str,
    layer: i16,
    coordinates: &[[f64; 2]],
    suffix: &str,
    kind: RoadFeatureKind,
    offset: f64,
    trim: EdgeTrim,
    zones: &[(f64, f64)],
    properties: &FeatureProperties,
) {
    let offset_coordinates = trim_line_ends(&offset_line(coordinates, offset), trim.start, trim.end);
    if offset_coordinates.len() < 2 {
        return;
    }
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

/// Draws a shoulder edge, trimming it back from either end (e.g. where a ramp's own shoulder edge
/// meets the mainline's) and entirely omitting it wherever an adjoining ramp's zone reaches this
/// mainline way (the ramp's own pavement occupies that space instead).
fn append_shoulder_edge(
    features: &mut Vec<RoadFeature>,
    feature_prefix: &str,
    layer: i16,
    coordinates: &[[f64; 2]],
    suffix: &str,
    offset: f64,
    width: f64,
    trim: EdgeTrim,
    zones: &[(f64, f64)],
    properties: &FeatureProperties,
) {
    if width <= 0.0 {
        return;
    }
    let offset_coordinates = trim_line_ends(&offset_line(coordinates, offset), trim.start, trim.end);
    if offset_coordinates.len() < 2 {
        return;
    }
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

fn ramp_intersection_trims(
    way_id: i64,
    coordinates: &[[f64; 2]],
    way_paths: &[(i64, Vec<[f64; 2]>, i16, bool, bool, bool)],
) -> (f64, f64) {
    let cumulative = cumulative_lengths(coordinates);
    let total = *cumulative.last().unwrap_or(&0.0);
    if total <= 2.0 {
        return (0.0, 0.0);
    }
    let Some((_, _, layer, bridge, tunnel, _)) = way_paths.iter().find(|(id, _, _, _, _, _)| *id == way_id) else {
        return (0.0, 0.0);
    };
    let mut start_trim = 0.0;
    let mut end_trim = 0.0;
    for (other_id, other_coordinates, other_layer, other_bridge, other_tunnel, other_is_link) in way_paths {
        if *other_id == way_id
            || *other_layer != *layer
            || *other_bridge != *bridge
            || *other_tunnel != *tunnel
        {
            continue;
        }
        for (index, segment) in coordinates.windows(2).enumerate() {
            for (other_index, other_segment) in other_coordinates.windows(2).enumerate() {
                let Some((current_ratio, other_ratio)) = segment_intersection(*segment.first().unwrap(), *segment.last().unwrap(), *other_segment.first().unwrap(), *other_segment.last().unwrap()) else {
                    continue;
                };
                let distance = cumulative[index]
                    + (segment[1][0] - segment[0][0]).hypot(segment[1][1] - segment[0][1]) * current_ratio;
                if distance <= 2.0 || total - distance <= 2.0 {
                    continue;
                }
                let distance_from_end = total - distance;
                let near_start = distance <= TERMINAL_INTERSECTION_SEARCH_FEET
                    && distance <= distance_from_end;
                let near_end = distance_from_end <= TERMINAL_INTERSECTION_SEARCH_FEET
                    && distance_from_end < distance;
                if !near_start && !near_end {
                    continue;
                }
                // A link-to-link event is a terminal only when the other link also reaches this
                // event from its endpoint. Parallel or crossing link interiors must remain intact.
                let other_cumulative = cumulative_lengths(other_coordinates);
                let other_total = *other_cumulative.last().unwrap_or(&0.0);
                let other_segment_length = (other_segment[1][0] - other_segment[0][0])
                    .hypot(other_segment[1][1] - other_segment[0][1]);
                let other_distance = other_cumulative[other_index]
                    + other_segment_length * other_ratio;
                let other_near_terminal = other_distance <= TERMINAL_INTERSECTION_SEARCH_FEET
                    || other_total - other_distance <= TERMINAL_INTERSECTION_SEARCH_FEET;
                if *other_is_link && !other_near_terminal {
                    continue;
                }
                if near_start {
                    start_trim = if start_trim == 0.0 { distance } else { start_trim.min(distance) };
                }
                if near_end {
                    end_trim = if end_trim == 0.0 { distance_from_end } else { end_trim.min(distance_from_end) };
                }
            }
        }
    }
    (start_trim, end_trim)
}

fn segment_intersection(
    start: [f64; 2],
    end: [f64; 2],
    other_start: [f64; 2],
    other_end: [f64; 2],
) -> Option<(f64, f64)> {
    let first_direction = [end[0] - start[0], end[1] - start[1]];
    let second_direction = [other_end[0] - other_start[0], other_end[1] - other_start[1]];
    let (first_ratio, second_ratio) = line_intersection(start, first_direction, other_start, second_direction)?;
    (0.0..=1.0).contains(&first_ratio)
        .then_some((first_ratio, second_ratio))
        .filter(|(_, second_ratio)| (0.0..=1.0).contains(second_ratio))
}

/// Builds a variable-width ribbon polygon that narrows to a point at gore ends, instead of the
/// constant-width stroke OSM's centerline-only data would otherwise force onto merging ramps.
fn tapered_ribbon_ring(
    coordinates: &[[f64; 2]],
    full_width: f64,
    taper_length_start: f64,
    taper_length_end: f64,
) -> Vec<[f64; 2]> {
    if coordinates.len() < 2 || full_width <= 0.0 {
        return Vec::new();
    }
    let cumulative = cumulative_lengths(coordinates);
    let total = *cumulative.last().unwrap_or(&0.0);
    let full_half_width = full_width / 2.0;
    let effective_taper_length_start = taper_length_start.min(total);
    let effective_taper_length_end = taper_length_end.min(total);
    let half_widths: Vec<f64> = cumulative
        .iter()
        .map(|&distance_from_start| {
            let mut half = full_half_width;
            if effective_taper_length_start > 0.0 {
                half = half.min(full_half_width * (distance_from_start / effective_taper_length_start).min(1.0));
            }
            if effective_taper_length_end > 0.0 {
                let distance_from_end = total - distance_from_start;
                half = half.min(full_half_width * (distance_from_end / effective_taper_length_end).min(1.0));
            }
            half.max(0.0)
        })
        .collect();
    let mut left = Vec::with_capacity(coordinates.len());
    let mut right = Vec::with_capacity(coordinates.len());
    for (index, point) in coordinates.iter().enumerate() {
        let previous = coordinates[index.saturating_sub(1)];
        let next = coordinates[(index + 1).min(coordinates.len() - 1)];
        let half = half_widths[index];
        let previous_direction = unit_direction(*point, previous)
            .or_else(|| unit_direction(next, *point));
        let next_direction = unit_direction(next, *point)
            .or_else(|| previous_direction);
        let (left_offset, right_offset) = match (previous_direction, next_direction) {
            (Some(previous_direction), Some(next_direction)) => {
                let previous_normal = [-previous_direction[1], previous_direction[0]];
                let next_normal = [-next_direction[1], next_direction[0]];
                (
                    bounded_miter(previous_normal, next_normal, half),
                    bounded_miter(
                        [-previous_normal[0], -previous_normal[1]],
                        [-next_normal[0], -next_normal[1]],
                        half,
                    ),
                )
            }
            _ => ([0.0, 0.0], [0.0, 0.0]),
        };
        left.push([point[0] + left_offset[0], point[1] + left_offset[1]]);
        right.push([point[0] + right_offset[0], point[1] + right_offset[1]]);
    }
    let mut ring = left;
    ring.extend(right.into_iter().rev());
    if let Some(first) = ring.first().copied() {
        ring.push(first);
    }
    ring
}

fn unit_direction(from: [f64; 2], to: [f64; 2]) -> Option<[f64; 2]> {
    let delta = [from[0] - to[0], from[1] - to[1]];
    let length = delta[0].hypot(delta[1]);
    (length > 1e-9).then_some([delta[0] / length, delta[1] / length])
}

fn bounded_miter(first_normal: [f64; 2], second_normal: [f64; 2], half_width: f64) -> [f64; 2] {
    if half_width == 0.0 {
        return [0.0, 0.0];
    }
    let bisector = [first_normal[0] + second_normal[0], first_normal[1] + second_normal[1]];
    let bisector_length = bisector[0].hypot(bisector[1]);
    if bisector_length <= 1e-9 {
        return [second_normal[0] * half_width, second_normal[1] * half_width];
    }
    let miter = [bisector[0] / bisector_length, bisector[1] / bisector_length];
    let scale = (half_width / (miter[0] * second_normal[0] + miter[1] * second_normal[1]))
        .abs()
        .min(half_width * 2.0);
    [miter[0] * scale, miter[1] * scale]
}

fn append_ramp_ribbon(
    features: &mut Vec<RoadFeature>,
    feature_prefix: &str,
    layer: i16,
    coordinates: &[[f64; 2]],
    width: f64,
    taper_length_start: f64,
    taper_length_end: f64,
    properties: &FeatureProperties,
) {
    let casing_ring = tapered_ribbon_ring(coordinates, width + 8.0, taper_length_start, taper_length_end);
    if !casing_ring.is_empty() {
        features.push(RoadFeature {
            id: format!("{feature_prefix}-casing-ribbon"),
            kind: RoadFeatureKind::RampCasingRibbon,
            layer,
            geometry: Geometry::Polygon(vec![casing_ring]),
            properties: FeatureProperties { render_width_feet: Some(width + 8.0), ..properties.clone() },
        });
    }
    let surface_ring = tapered_ribbon_ring(coordinates, width, taper_length_start, taper_length_end);
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

/// The gore stripe polygon: apex at the fog-line crossing (the theoretical gore nose), widening to
/// the ramp's and the mainline's own fog lines at the shoulder-edge-crossing distance — the depth
/// MUTCD/VDOT hatching covers.
fn append_ramp_gore(
    features: &mut Vec<RoadFeature>,
    feature_prefix: &str,
    layer: i16,
    gore: &GoreGeometry,
    at_start: bool,
    properties: &FeatureProperties,
) {
    features.push(RoadFeature {
        id: format!("{feature_prefix}-gore-{}", if at_start { "start" } else { "end" }),
        kind: RoadFeatureKind::RampGore,
        layer: layer + 2,
        geometry: Geometry::Polygon(vec![vec![
            gore.tip,
            gore.mainline_fog_at_base,
            gore.ramp_fog_at_base,
            gore.tip,
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
    fn mainline_edge_point_offsets_toward_the_ramp() {
        // Mainline runs due "north" (increasing y); sign -1.0 selects the +x side.
        let anchor = MainlineAnchor { tangent: [0.0, 1.0], fog_half_width: 18.0, half_width: 25.0 };
        let junction_node = [100.0, 200.0];

        let edge_point = mainline_edge_point(junction_node, 25.0, -1.0, &anchor);

        assert!((edge_point[0] - 125.0).abs() < 1e-9);
        assert!((edge_point[1] - 200.0).abs() < 1e-9);
    }

    #[test]
    fn computes_gore_geometry_for_a_hand_verifiable_perpendicular_junction() {
        // Mainline runs due "north" along the y-axis; the ramp approaches due "east" along the
        // x-axis and touches it at the origin — a 90-degree case chosen so every intersection can
        // be checked by hand instead of only trusting the code that produced it.
        let mainline_anchor = MainlineAnchor { tangent: [0.0, 1.0], fog_half_width: 12.0, half_width: 18.0 };
        let node = [0.0, 0.0];
        let ramp_adjacent = [100.0, 0.0];

        let gore = compute_gore_geometry(node, ramp_adjacent, 1, 4.0, 10.0, &mainline_anchor)
            .expect("perpendicular junction should not be degenerate");

        assert!((gore.tip[0] - 12.0).abs() < 1e-9 && (gore.tip[1] - -6.0).abs() < 1e-9);
        assert!((gore.base[0] - 18.0).abs() < 1e-9 && (gore.base[1] - -10.0).abs() < 1e-9);
        assert!((gore.ramp_fog_at_base[0] - 18.0).abs() < 1e-9 && (gore.ramp_fog_at_base[1] - -6.0).abs() < 1e-9);
        assert!((gore.mainline_fog_at_base[0] - 12.0).abs() < 1e-9 && (gore.mainline_fog_at_base[1] - -10.0).abs() < 1e-9);
        assert!((gore.ramp_trim_to_tip - 12.0).abs() < 1e-9);
        assert!((gore.ramp_trim_to_base - 18.0).abs() < 1e-9);
        assert!((gore.mainline_arc_to_tip - -6.0).abs() < 1e-9);
        assert!((gore.mainline_arc_to_base - -10.0).abs() < 1e-9);
        assert_eq!(gore.near_side_sign, -1.0);
    }

    fn nose(arc: f64, kind: RampNoseKind, side_sign: f64) -> RampNose {
        RampNose { fog_arc: arc, shoulder_arc: arc, kind, side_sign }
    }

    #[test]
    fn chains_an_entrance_zone_to_the_next_exit_on_the_same_side() {
        let noses = vec![
            nose(500.0, RampNoseKind::Entrance, 1.0),
            nose(900.0, RampNoseKind::Exit, 1.0),
        ];

        let zones = compute_marking_zones(&noses, 2_000.0, ZoneReference::FogLine);

        assert_eq!(zones.len(), 1);
        assert_eq!(zones[0].start, 500.0);
        assert_eq!(zones[0].end, 900.0);
    }

    #[test]
    fn falls_back_to_a_fixed_taper_zone_for_an_isolated_entrance() {
        let noses = vec![nose(500.0, RampNoseKind::Entrance, 1.0)];

        let zones = compute_marking_zones(&noses, 2_000.0, ZoneReference::FogLine);

        assert_eq!(zones.len(), 1);
        assert_eq!(zones[0].start, 500.0);
        assert_eq!(zones[0].end, 500.0 + RAMP_GORE_LENGTH_FEET);
    }

    #[test]
    fn falls_back_to_a_fixed_taper_zone_for_an_isolated_exit() {
        let noses = vec![nose(500.0, RampNoseKind::Exit, -1.0)];

        let zones = compute_marking_zones(&noses, 2_000.0, ZoneReference::FogLine);

        assert_eq!(zones.len(), 1);
        assert_eq!(zones[0].start, 500.0 - RAMP_GORE_LENGTH_FEET);
        assert_eq!(zones[0].end, 500.0);
    }

    #[test]
    fn does_not_chain_zones_on_opposite_sides_of_the_mainline() {
        let noses = vec![
            nose(500.0, RampNoseKind::Entrance, 1.0),
            nose(900.0, RampNoseKind::Exit, -1.0),
        ];

        let zones = compute_marking_zones(&noses, 2_000.0, ZoneReference::FogLine);

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
        let ramp_casing = scene
            .features
            .iter()
            .find(|feature| feature.id == "way-96-0-casing")
            .expect("ramp casing");
        // The ramp centerline stays for section selection, but its pavement no longer renders at
        // a constant width — the tapered ribbons below draw the visible merge instead.
        assert_eq!(ramp_surface.properties.render_width_feet, Some(0.0));
        assert_eq!(ramp_casing.properties.render_width_feet, Some(0.0));
        let ramp_left_edge = scene
            .features
            .iter()
            .find(|feature| feature.id == "way-96-0-left-edge")
            .expect("ramp near-side (left) fog line");
        let ramp_right_edge = scene
            .features
            .iter()
            .find(|feature| feature.id == "way-96-0-right-edge")
            .expect("ramp far-side (right) fog line");
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
        let Geometry::LineString(left_fog_points) = &ramp_left_edge.geometry else {
            panic!("left fog line should be a line")
        };
        let Geometry::LineString(right_fog_points) = &ramp_right_edge.geometry else {
            panic!("right fog line should be a line")
        };
        let Geometry::Polygon(gore_rings) = &gore.geometry else {
            panic!("gore should be a polygon")
        };
        let Geometry::Polygon(ribbon_rings) = &ramp_surface_ribbon.geometry else {
            panic!("ramp surface ribbon should be a polygon")
        };
        // Both ramp fog lines must stop at the calculated gore tip instead of crossing the
        // mainline; the shoulder-side treatment remains asymmetric.
        let untrimmed_left_start = offset_line(surface_points, -6.0)[0];
        let left_trim_distance = (left_fog_points[0][0] - untrimmed_left_start[0])
            .hypot(left_fog_points[0][1] - untrimmed_left_start[1]);
        assert!(left_trim_distance > 1.0, "expected the far-side (left) fog line to stop at the gore, got {left_trim_distance} ft");
        let untrimmed_right_start = offset_line(surface_points, 6.0)[0];
        let right_trim_distance = (right_fog_points[0][0] - untrimmed_right_start[0])
            .hypot(right_fog_points[0][1] - untrimmed_right_start[1]);
        assert!(right_trim_distance > 1.0, "expected the near-side (right) fog line to stop at the gore, got {right_trim_distance} ft");
        // The ribbon narrows to a point at the mainline's pavement edge (offset from the shared
        // OSM junction node using both roadways' real approach angles) instead of continuing at
        // full pavement width all the way to the mainline's centerline.
        let ribbon_ring = &ribbon_rings[0];
        let tip_offset_from_junction_node =
            (ribbon_ring[0][0] - surface_points[0][0]).hypot(ribbon_ring[0][1] - surface_points[0][1]);
        assert!(
            (20.0..35.0).contains(&tip_offset_from_junction_node),
            "expected the ribbon tip roughly 20-35 ft from the junction node, got {tip_offset_from_junction_node}"
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

    #[test]
    fn bounds_ramp_ribbon_joins_at_sharp_bends() {
        let ring = tapered_ribbon_ring(
            &[[0.0, 0.0], [100.0, 0.0], [100.0, 10.0]],
            24.0,
            0.0,
            0.0,
        );

        assert!(ring
            .iter()
            .all(|point| point[0].abs() < 200.0 && point[1].abs() < 200.0));
    }

    #[test]
    fn trims_a_ramp_at_an_unshared_same_layer_crossing() {
        let ramp = vec![[0.0, 0.0], [100.0, 0.0]];
        let crossing = vec![[80.0, -50.0], [80.0, 50.0]];
        let paths = vec![
            (1, ramp.clone(), 0, false, false, true),
            (2, crossing, 0, false, false, false),
        ];

        assert_eq!(ramp_intersection_trims(1, &ramp, &paths), (0.0, 20.0));
    }
}
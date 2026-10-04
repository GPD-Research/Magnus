//! Chains the per-way road fragments the topology worker emits into
//! continuous carriageway corridors and irons out the lateral jogs between
//! them.
//!
//! OSM only carries centerlines and lane counts, so every way boundary where
//! the lane count changes arrives as an abrupt sideways step in the centred
//! fragment geometry. A corridor keeps the driver's-left edge continuous,
//! averages the edge over a long window so junction artifacts disappear while
//! genuine curves survive, and widens the whole corridor to its widest
//! fragment. The result is a rough-but-smooth pavement underlay with edge
//! lines that users draw the rest of the markings on.

use crate::scene::{LaneRecord, Position};

/// Point spacing after resampling, in feet.
const SAMPLE_STEP_FEET: f64 = 10.0;
/// Largest heading change across a node that still reads as "the same road".
const MAX_CONTINUATION_DEGREES: f64 = 50.0;
/// Fragment ends further apart than this at a shared junction are not the
/// same road: a short stub whose trims exceed its length has no reliable end.
const MAX_JOIN_GAP_FEET: f64 = 60.0;
/// Fragments shorter than this that osm2streets trimmed away entirely are
/// junction stubs, not roadway; they are dropped rather than smoothed.
const MIN_FRAGMENT_FEET: f64 = 30.0;
/// Edge-line slivers shorter than this left over after clipping are noise.
const MIN_EDGE_PIECE_FEET: f64 = 5.0;
/// Standard driving lane width used when widening a corridor.
const LANE_WIDTH_FEET: f64 = 12.0;
/// How far each open corridor end is extended so merging pavement overlaps
/// through the gore instead of stopping short of it.
const END_OVERLAP_FEET: f64 = 20.0;

#[derive(Debug, Clone)]
pub struct Fragment {
    pub id: i64,
    pub source_way_ids: Vec<i64>,
    pub endpoint_node_ids: Vec<i64>,
    pub layer: i16,
    pub highway: String,
    pub bridge: Option<bool>,
    pub tunnel: Option<bool>,
    pub lane_records: Vec<LaneRecord>,
    pub lane_count: usize,
    pub center_line: Vec<Position>,
    pub width_feet: f64,
    pub trim_start_feet: f64,
    pub trim_end_feet: f64,
}

#[derive(Debug, Clone)]
pub struct Junction {
    pub connected_road_ids: Vec<i64>,
    pub polygon: Vec<Position>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Travel {
    /// Traffic runs along the center line in point order.
    Forward,
    /// Traffic runs against point order.
    Backward,
    /// Both directions share the pavement (local two-way roads).
    TwoWay,
}

#[derive(Debug, Clone)]
pub struct Corridor {
    pub id: i64,
    pub fragment_ids: Vec<i64>,
    pub source_way_ids: Vec<i64>,
    pub endpoint_node_ids: Vec<i64>,
    pub layer: i16,
    pub highway: String,
    pub bridge: Option<bool>,
    pub tunnel: Option<bool>,
    pub lane_records: Vec<LaneRecord>,
    pub lane_count: usize,
    pub travel: Travel,
    /// Smoothed center line, oriented with traffic for one-way corridors.
    pub center_line: Vec<Position>,
    pub width_feet: f64,
}

impl Corridor {
    /// Edge line on the driver's left of the traveled way.
    pub fn left_edge(&self) -> Vec<Position> {
        offset_polyline(&self.center_line, -self.width_feet / 2.0)
    }

    /// Edge line on the driver's right of the traveled way.
    pub fn right_edge(&self) -> Vec<Position> {
        offset_polyline(&self.center_line, self.width_feet / 2.0)
    }

    pub fn surface_polygon(&self, extra_width_feet: f64) -> Vec<Position> {
        let half = self.width_feet / 2.0 + extra_width_feet;
        let mut ring = offset_polyline(&self.center_line, -half);
        let mut right = offset_polyline(&self.center_line, half);
        right.reverse();
        ring.extend(right);
        if let Some(first) = ring.first().copied() {
            ring.push(first);
        }
        ring
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RoadClass {
    Mainline,
    Ramp,
    Local,
}

fn road_class(highway: &str) -> RoadClass {
    if highway.ends_with("_link") {
        RoadClass::Ramp
    } else if matches!(highway, "motorway" | "trunk") {
        RoadClass::Mainline
    } else {
        RoadClass::Local
    }
}

fn smoothing_window_feet(class: RoadClass) -> f64 {
    match class {
        RoadClass::Mainline => 300.0,
        RoadClass::Ramp => 80.0,
        RoadClass::Local => 120.0,
    }
}

pub fn travel_direction(lane_records: &[LaneRecord]) -> Travel {
    let mut forward = false;
    let mut backward = false;
    for lane in lane_records
        .iter()
        .filter(|lane| lane.lane_type == "driving")
    {
        match lane.direction.as_str() {
            "forward" => forward = true,
            "backward" => backward = true,
            _ => {}
        }
    }
    match (forward, backward) {
        (true, false) => Travel::Forward,
        (false, true) => Travel::Backward,
        _ => Travel::TwoWay,
    }
}

/// A fragment's center line before osm2streets trimmed it back from its
/// junctions, so consecutive fragments meet at the shared node again.
fn untrimmed_center_line(fragment: &Fragment) -> Vec<Position> {
    extend_line_ends(
        &fragment.center_line,
        fragment.trim_start_feet.max(0.0),
        fragment.trim_end_feet.max(0.0),
    )
}

fn extend_line_ends(line: &[Position], start_feet: f64, end_feet: f64) -> Vec<Position> {
    let mut extended = line.to_vec();
    if line.len() < 2 {
        return extended;
    }
    if let Some(point) = project_point(line[1], line[0], start_feet) {
        extended[0] = point;
    }
    let last = line.len() - 1;
    if let Some(point) = project_point(line[last - 1], line[last], end_feet) {
        extended[last] = point;
    }
    extended
}

fn project_point(from: Position, to: Position, distance: f64) -> Option<Position> {
    let dx = to[0] - from[0];
    let dy = to[1] - from[1];
    let length = dx.hypot(dy);
    if length == 0.0 || distance <= 0.0 {
        return None;
    }
    Some([
        to[0] + dx / length * distance,
        to[1] + dy / length * distance,
    ])
}

fn centroid(points: &[Position]) -> Option<Position> {
    if points.is_empty() {
        return None;
    }
    let n = points.len() as f64;
    Some([
        points.iter().map(|p| p[0]).sum::<f64>() / n,
        points.iter().map(|p| p[1]).sum::<f64>() / n,
    ])
}

fn polyline_length(line: &[Position]) -> f64 {
    line.windows(2).map(|pair| distance(pair[0], pair[1])).sum()
}

fn distance(a: Position, b: Position) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

fn heading(from: Position, to: Position) -> f64 {
    (to[1] - from[1]).atan2(to[0] - from[0])
}

fn heading_difference_degrees(a: f64, b: f64) -> f64 {
    let mut d = (a - b).abs() % std::f64::consts::TAU;
    if d > std::f64::consts::PI {
        d = std::f64::consts::TAU - d;
    }
    d.to_degrees()
}

/// A fragment oriented so traffic (or, for two-way roads, point order) runs
/// from `line[0]` to `line[last]`.
struct Oriented {
    index: usize,
    class: RoadClass,
    two_way: bool,
    line: Vec<Position>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum End {
    Start,
    Finish,
}

fn oriented_line(line: &[Position], flip: bool) -> Vec<Position> {
    if flip {
        line.iter().rev().copied().collect()
    } else {
        line.to_vec()
    }
}

/// Chains fragments into corridors. A fragment's downstream end continues
/// into the upstream end of a same-class neighbour at a shared junction when
/// the heading change is small; ramps never chain into mainlines.
pub fn build_corridors(fragments: &[Fragment], junctions: &[Junction]) -> Vec<Corridor> {
    let mut oriented = fragments
        .iter()
        .enumerate()
        .filter(|(_, fragment)| fragment.center_line.len() >= 2 && fragment.width_feet > 0.0)
        .filter(|(_, fragment)| {
            let length = polyline_length(&fragment.center_line);
            length >= MIN_FRAGMENT_FEET
                || fragment.trim_start_feet + fragment.trim_end_feet <= length
        })
        .map(|(index, fragment)| {
            let mut line = untrimmed_center_line(fragment);
            if travel_direction(&fragment.lane_records) == Travel::Backward {
                line.reverse();
            }
            Oriented {
                index,
                class: road_class(&fragment.highway),
                two_way: travel_direction(&fragment.lane_records) == Travel::TwoWay,
                line,
            }
        })
        .collect::<Vec<_>>();
    let by_id = oriented
        .iter()
        .enumerate()
        .map(|(slot, o)| (fragments[o.index].id, slot))
        .collect::<std::collections::HashMap<_, _>>();

    // next[slot] = slot that continues this fragment; prev[slot] = the one it continues.
    let mut next = vec![None; oriented.len()];
    let mut prev = vec![None; oriented.len()];
    for junction in junctions {
        let Some(node) = centroid(&junction.polygon) else {
            continue;
        };
        let mut ends = Vec::new();
        for road_id in &junction.connected_road_ids {
            let Some(&slot) = by_id.get(road_id) else {
                continue;
            };
            let line = &oriented[slot].line;
            let first = line[0];
            let last = line[line.len() - 1];
            let end = if distance(first, node) <= distance(last, node) {
                End::Start
            } else {
                End::Finish
            };
            ends.push((slot, end));
        }
        // Two-way roads have no traffic orientation, so an unlinked one may
        // be read in either direction to continue a neighbour.
        let two_way = oriented.iter().map(|o| o.two_way).collect::<Vec<_>>();
        let flippable = |slot: usize, next: &[Option<usize>], prev: &[Option<usize>]| {
            two_way[slot] && next[slot].is_none() && prev[slot].is_none()
        };
        let mut candidates = Vec::new();
        for &(from, from_end) in &ends {
            let from_flip = from_end == End::Start && flippable(from, &next, &prev);
            if (from_end != End::Finish && !from_flip) || next[from].is_some() {
                continue;
            }
            for &(to, to_end) in &ends {
                let to_flip = to_end == End::Finish && flippable(to, &next, &prev);
                if (to_end != End::Start && !to_flip) || to == from || prev[to].is_some() {
                    continue;
                }
                if oriented[from].class != oriented[to].class {
                    continue;
                }
                let a = oriented_line(&oriented[from].line, from_flip);
                let b = oriented_line(&oriented[to].line, to_flip);
                if distance(a[a.len() - 1], b[0]) > MAX_JOIN_GAP_FEET {
                    continue;
                }
                let out_heading = heading(a[a.len() - 2], a[a.len() - 1]);
                let in_heading = heading(b[0], b[1]);
                let turn = heading_difference_degrees(out_heading, in_heading);
                if turn <= MAX_CONTINUATION_DEGREES {
                    candidates.push((turn, from, to, from_flip, to_flip));
                }
            }
        }
        candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
        for (_, from, to, from_flip, to_flip) in candidates {
            if next[from].is_some() || prev[to].is_some() {
                continue;
            }
            if (from_flip && !flippable(from, &next, &prev))
                || (to_flip && !flippable(to, &next, &prev))
            {
                continue;
            }
            if from_flip {
                oriented[from].line.reverse();
            }
            if to_flip {
                oriented[to].line.reverse();
            }
            next[from] = Some(to);
            prev[to] = Some(from);
        }
    }

    let mut corridors = Vec::new();
    let mut visited = vec![false; oriented.len()];
    for start in 0..oriented.len() {
        if prev[start].is_some() || visited[start] {
            continue;
        }
        let mut chain = Vec::new();
        let mut cursor = Some(start);
        while let Some(slot) = cursor {
            if visited[slot] {
                break;
            }
            visited[slot] = true;
            chain.push(slot);
            cursor = next[slot];
        }
        corridors.push(assemble(&chain, &oriented, fragments));
    }
    // Any cycle (a loop ramp chained back onto itself) has no chain start.
    for start in 0..oriented.len() {
        if visited[start] {
            continue;
        }
        let mut chain = Vec::new();
        let mut cursor = Some(start);
        while let Some(slot) = cursor {
            if visited[slot] {
                break;
            }
            visited[slot] = true;
            chain.push(slot);
            cursor = next[slot];
        }
        corridors.push(assemble(&chain, &oriented, fragments));
    }
    corridors
}

fn assemble(chain: &[usize], oriented: &[Oriented], fragments: &[Fragment]) -> Corridor {
    let members = chain
        .iter()
        .map(|&slot| &fragments[oriented[slot].index])
        .collect::<Vec<_>>();
    let widest = members
        .iter()
        .max_by(|a, b| a.width_feet.total_cmp(&b.width_feet))
        .expect("chain is never empty");
    let class = oriented[chain[0]].class;
    let travel = {
        let directions = members
            .iter()
            .map(|f| travel_direction(&f.lane_records))
            .collect::<Vec<_>>();
        if directions.iter().all(|&t| t != Travel::TwoWay) {
            Travel::Forward
        } else {
            Travel::TwoWay
        }
    };
    let driving_lanes = widest
        .lane_records
        .iter()
        .filter(|lane| lane.lane_type == "driving")
        .count();
    let width_feet = if driving_lanes > 0 && class != RoadClass::Local {
        (driving_lanes as f64 * LANE_WIDTH_FEET).max(widest.width_feet)
    } else {
        widest.width_feet
    };

    // Anchor on the driver's-left edge of each fragment (so lane additions
    // grow on the right), then smooth that edge and re-centre it.
    let mut left_edge = Vec::new();
    for (position, &slot) in chain.iter().enumerate() {
        let fragment = &fragments[oriented[slot].index];
        let line = &oriented[slot].line;
        let edge = if travel == Travel::TwoWay {
            line.clone()
        } else {
            offset_polyline(line, -fragment.width_feet / 2.0)
        };
        // osm2streets sometimes extends a fragment back past the shared node
        // (negative trims); points that fall behind the previous fragment's
        // end would fold the corridor back on itself, so they are skipped.
        let tangent = (position > 0 && left_edge.len() >= 2).then(|| {
            let end = left_edge[left_edge.len() - 1];
            let before = left_edge[left_edge.len() - 2];
            let h = heading(before, end);
            (end, [h.cos(), h.sin()])
        });
        for point in edge {
            if let Some((end, [tx, ty])) = tangent {
                let along = (point[0] - end[0]) * tx + (point[1] - end[1]) * ty;
                if along < -0.01 || distance(point, end) < 0.01 {
                    continue;
                }
            }
            left_edge.push(point);
        }
    }
    let resampled = resample(&left_edge, SAMPLE_STEP_FEET);
    let smoothed = moving_average(&resampled, smoothing_window_feet(class));
    let smoothed = extend_line_ends(&smoothed, END_OVERLAP_FEET, END_OVERLAP_FEET);
    let center_line = if travel == Travel::TwoWay {
        smoothed
    } else {
        offset_polyline(&smoothed, width_feet / 2.0)
    };

    let mut source_way_ids = Vec::new();
    let mut endpoint_node_ids = Vec::new();
    for fragment in &members {
        for id in &fragment.source_way_ids {
            if !source_way_ids.contains(id) {
                source_way_ids.push(*id);
            }
        }
        for id in &fragment.endpoint_node_ids {
            if !endpoint_node_ids.contains(id) {
                endpoint_node_ids.push(*id);
            }
        }
    }
    Corridor {
        id: members[0].id,
        fragment_ids: members.iter().map(|f| f.id).collect(),
        source_way_ids,
        endpoint_node_ids,
        layer: members.iter().map(|f| f.layer).max().unwrap_or(0),
        highway: members[0].highway.clone(),
        bridge: any_flag(members.iter().map(|f| f.bridge)),
        tunnel: any_flag(members.iter().map(|f| f.tunnel)),
        lane_records: widest.lane_records.clone(),
        lane_count: widest.lane_count,
        travel,
        center_line,
        width_feet,
    }
}

/// `Some(true)` if any fragment carries the flag, `Some(false)` if the flag is
/// known on any fragment, `None` when no fragment reports it.
fn any_flag(flags: impl Iterator<Item = Option<bool>>) -> Option<bool> {
    flags.fold(None, |acc, flag| match (acc, flag) {
        (Some(true), _) | (_, Some(true)) => Some(true),
        (Some(false), _) | (_, Some(false)) => Some(false),
        _ => None,
    })
}

/// Cuts `line` where it enters any of `polygons` (closed rings) and returns
/// the pieces lying outside them, each ending exactly on the ring it meets.
/// Edge lines of overlapping corridors therefore stop at the other road's
/// edge instead of crossing it; a line entirely inside yields no pieces.
pub fn clip_outside_polygons(line: &[Position], polygons: &[Vec<Position>]) -> Vec<Vec<Position>> {
    if line.len() < 2 {
        return Vec::new();
    }
    if polygons.is_empty() {
        return vec![line.to_vec()];
    }
    let inside = |p: Position| polygons.iter().any(|ring| point_in_ring(p, ring));
    let mut pieces: Vec<Vec<Position>> = Vec::new();
    let mut current: Vec<Position> = Vec::new();
    let mut outside = !inside(line[0]);
    if outside {
        current.push(line[0]);
    }
    for pair in line.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        let mut crossings: Vec<(f64, Position)> = polygons
            .iter()
            .flat_map(|ring| {
                ring.windows(2)
                    .filter_map(move |edge| segment_intersection(a, b, edge[0], edge[1]))
            })
            .collect();
        crossings.sort_by(|x, y| x.0.total_cmp(&y.0));
        // A crossing exactly at a ring vertex is reported by both adjacent
        // ring edges; count it once.
        crossings.dedup_by(|later, earlier| (later.0 - earlier.0).abs() < 1e-9);
        for (_, point) in crossings {
            current.push(point);
            if outside {
                pieces.push(std::mem::take(&mut current));
            }
            outside = !outside;
        }
        let b_outside = !inside(b);
        if b_outside != outside {
            // Crossing parity disagreed with containment (grazed a vertex);
            // trust containment.
            if outside {
                pieces.push(std::mem::take(&mut current));
            } else {
                current.clear();
            }
            outside = b_outside;
        }
        if outside {
            current.push(b);
        }
    }
    if outside {
        pieces.push(current);
    }
    pieces
        .into_iter()
        .filter(|piece| polyline_length(piece) >= MIN_EDGE_PIECE_FEET)
        .collect()
}

fn point_in_ring(p: Position, ring: &[Position]) -> bool {
    let mut inside = false;
    for edge in ring.windows(2) {
        let (a, b) = (edge[0], edge[1]);
        if (a[1] > p[1]) != (b[1] > p[1]) {
            let x = a[0] + (p[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
            if p[0] < x {
                inside = !inside;
            }
        }
    }
    inside
}

/// Intersection of segments a->b and c->d as (t along a->b, point), excluding
/// the a endpoint so chained segments do not double-count a shared vertex.
fn segment_intersection(
    a: Position,
    b: Position,
    c: Position,
    d: Position,
) -> Option<(f64, Position)> {
    let r = [b[0] - a[0], b[1] - a[1]];
    let s = [d[0] - c[0], d[1] - c[1]];
    let denom = r[0] * s[1] - r[1] * s[0];
    if denom.abs() < 1e-12 {
        return None;
    }
    let qp = [c[0] - a[0], c[1] - a[1]];
    let t = (qp[0] * s[1] - qp[1] * s[0]) / denom;
    let u = (qp[0] * r[1] - qp[1] * r[0]) / denom;
    if t > 1e-9 && t <= 1.0 && (0.0..=1.0).contains(&u) {
        Some((t, [a[0] + t * r[0], a[1] + t * r[1]]))
    } else {
        None
    }
}

/// Offsets a polyline to its right (positive) or left (negative) by
/// averaging the normals of the segments meeting at each vertex.
pub fn offset_polyline(line: &[Position], distance_feet: f64) -> Vec<Position> {
    if line.len() < 2 || distance_feet == 0.0 {
        return line.to_vec();
    }
    let normals = line
        .windows(2)
        .map(|pair| {
            let dx = pair[1][0] - pair[0][0];
            let dy = pair[1][1] - pair[0][1];
            let length = dx.hypot(dy);
            if length == 0.0 {
                [0.0, 0.0]
            } else {
                // Right-hand normal in a y-up frame.
                [dy / length, -dx / length]
            }
        })
        .collect::<Vec<_>>();
    line.iter()
        .enumerate()
        .map(|(index, point)| {
            let normal = if index == 0 {
                normals[0]
            } else if index == line.len() - 1 {
                normals[index - 1]
            } else {
                let a = normals[index - 1];
                let b = normals[index];
                let sum = [a[0] + b[0], a[1] + b[1]];
                let length = sum[0].hypot(sum[1]);
                if length < 1e-9 {
                    a
                } else {
                    // Mitre so parallel edges stay parallel around curves.
                    let cos_half = length / 2.0;
                    let scale = 1.0 / cos_half.max(0.5);
                    [sum[0] / length * scale, sum[1] / length * scale]
                }
            };
            [
                point[0] + normal[0] * distance_feet,
                point[1] + normal[1] * distance_feet,
            ]
        })
        .collect()
}

pub fn resample(line: &[Position], step_feet: f64) -> Vec<Position> {
    if line.len() < 2 {
        return line.to_vec();
    }
    let mut out = vec![line[0]];
    let mut carry = 0.0;
    for pair in line.windows(2) {
        let segment = distance(pair[0], pair[1]);
        if segment == 0.0 {
            continue;
        }
        let mut along = step_feet - carry;
        while along < segment {
            let t = along / segment;
            out.push([
                pair[0][0] + (pair[1][0] - pair[0][0]) * t,
                pair[0][1] + (pair[1][1] - pair[0][1]) * t,
            ]);
            along += step_feet;
        }
        carry = segment - (along - step_feet);
    }
    let last = line[line.len() - 1];
    if distance(*out.last().expect("non-empty"), last) > step_feet / 4.0 {
        out.push(last);
    } else {
        *out.last_mut().expect("non-empty") = last;
    }
    out
}

/// Centred moving average over a window of `window_feet` along a line that
/// has been resampled at [`SAMPLE_STEP_FEET`]. The window shrinks towards the
/// ends so the endpoints stay put.
pub fn moving_average(line: &[Position], window_feet: f64) -> Vec<Position> {
    let radius = ((window_feet / SAMPLE_STEP_FEET) / 2.0).round() as usize;
    if line.len() < 3 || radius == 0 {
        return line.to_vec();
    }
    (0..line.len())
        .map(|index| {
            let reach = radius.min(index).min(line.len() - 1 - index);
            if reach == 0 {
                return line[index];
            }
            let window = &line[index - reach..=index + reach];
            let n = window.len() as f64;
            [
                window.iter().map(|p| p[0]).sum::<f64>() / n,
                window.iter().map(|p| p[1]).sum::<f64>() / n,
            ]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lanes(count: usize) -> Vec<LaneRecord> {
        (0..count)
            .map(|_| LaneRecord {
                lane_type: "driving".into(),
                direction: "forward".into(),
                width_feet: 12.0,
                source_evidence: None,
            })
            .collect()
    }

    fn fragment(id: i64, lanes_count: usize, line: Vec<Position>) -> Fragment {
        Fragment {
            id,
            source_way_ids: vec![id * 10],
            endpoint_node_ids: vec![],
            layer: 0,
            highway: "motorway".into(),
            bridge: None,
            tunnel: None,
            lane_records: lanes(lanes_count),
            lane_count: lanes_count,
            center_line: line,
            width_feet: lanes_count as f64 * 12.0,
            trim_start_feet: 0.0,
            trim_end_feet: 0.0,
        }
    }

    fn junction(ids: &[i64], at: Position) -> Junction {
        Junction {
            connected_road_ids: ids.to_vec(),
            polygon: vec![
                [at[0] - 1.0, at[1] - 1.0],
                [at[0] + 1.0, at[1] - 1.0],
                [at[0] + 1.0, at[1] + 1.0],
                [at[0] - 1.0, at[1] + 1.0],
            ],
        }
    }

    #[test]
    fn permanent_lane_gain_keeps_the_drivers_left_edge_straight() {
        // Northbound (y increasing): a 4-lane fragment centred at x=0 meets a
        // 6-lane fragment whose centre is a lane further right, as osm2streets
        // centres each on its own width. Driver's left is -x.
        let four = fragment(1, 4, vec![[0.0, 0.0], [0.0, 1000.0]]);
        let six = fragment(2, 6, vec![[12.0, 1000.0], [12.0, 2000.0]]);
        let ramp = Fragment {
            highway: "motorway_link".into(),
            ..fragment(3, 2, vec![[80.0, 600.0], [36.0, 1000.0]])
        };
        let corridors = build_corridors(&[four, six, ramp], &[junction(&[1, 2, 3], [0.0, 1000.0])]);
        assert_eq!(corridors.len(), 2, "mainline chains, ramp stays separate");
        let mainline = corridors
            .iter()
            .find(|c| c.fragment_ids == vec![1, 2])
            .expect("chained mainline");
        assert_eq!(mainline.width_feet, 72.0);
        let left = mainline.left_edge();
        let xs = left.iter().map(|p| p[0]).collect::<Vec<_>>();
        let (min, max) = xs
            .iter()
            .fold((f64::MAX, f64::MIN), |(lo, hi), &x| (lo.min(x), hi.max(x)));
        assert!(
            max - min < 0.5,
            "left edge should not step at the lane gain: {min}..{max}"
        );
        assert!((min - -24.0).abs() < 0.5, "left edge sits at -24 ft: {min}");
        let right = mainline.right_edge();
        assert!(right.iter().all(|p| (p[0] - 48.0).abs() < 0.5));
    }

    #[test]
    fn irons_out_a_lateral_jog_at_a_shared_node() {
        let a = fragment(1, 2, vec![[0.0, 0.0], [0.0, 1000.0]]);
        let b = fragment(2, 2, vec![[8.0, 1000.0], [8.0, 2000.0]]);
        let corridors = build_corridors(&[a, b], &[junction(&[1, 2], [4.0, 1000.0])]);
        assert_eq!(corridors.len(), 1);
        let line = &corridors[0].center_line;
        let max_step = line
            .windows(2)
            .map(|pair| (pair[1][0] - pair[0][0]).abs())
            .fold(0.0, f64::max);
        assert!(max_step < 1.0, "step per 10 ft sample is {max_step}");
        assert!((line[0][0] - 0.0).abs() < 0.01);
        assert!(
            (line[line.len() - 1][0] - 8.0).abs() < 0.01,
            "{:?} {:?}",
            &line[line.len() - 3..],
            &line[..3]
        );
    }

    #[test]
    fn does_not_chain_across_a_sharp_turn_or_into_a_ramp() {
        let a = fragment(1, 2, vec![[0.0, 0.0], [0.0, 1000.0]]);
        let turn = fragment(2, 2, vec![[0.0, 1000.0], [1000.0, 1000.0]]);
        let ramp = Fragment {
            highway: "motorway_link".into(),
            ..fragment(3, 1, vec![[0.0, 1000.0], [0.0, 2000.0]])
        };
        let corridors = build_corridors(&[a, turn, ramp], &[junction(&[1, 2, 3], [0.0, 1000.0])]);
        assert_eq!(corridors.len(), 3);
    }

    #[test]
    fn does_not_chain_into_a_fragment_that_only_ends_nearby() {
        // `b` finishes at the node, so it continues `a` only if it is read
        // backwards; the far-apart ends rule it out.
        let a = fragment(1, 2, vec![[0.0, 0.0], [0.0, 1000.0]]);
        let b = fragment(2, 2, vec![[0.0, 1500.0], [0.0, 1000.0]]);
        let corridors = build_corridors(&[a, b], &[junction(&[1, 2], [0.0, 1000.0])]);
        assert_eq!(corridors.len(), 2);
    }

    #[test]
    fn drops_trimmed_away_junction_stubs() {
        let mut stub = fragment(1, 1, vec![[0.0, 0.0], [0.0, 5.0]]);
        stub.trim_start_feet = 3.0;
        stub.trim_end_feet = 90.0;
        assert!(build_corridors(&[stub], &[]).is_empty());
    }

    #[test]
    fn overlapping_fragments_do_not_fold_back() {
        let a = fragment(1, 2, vec![[0.0, 0.0], [0.0, 1050.0]]);
        let b = fragment(2, 2, vec![[0.0, 1000.0], [0.0, 2000.0]]);
        let corridors = build_corridors(&[a, b], &[junction(&[1, 2], [0.0, 1025.0])]);
        assert_eq!(corridors.len(), 1);
        let line = &corridors[0].center_line;
        assert!(line.windows(2).all(|pair| pair[1][1] > pair[0][1]));
    }

    #[test]
    fn two_way_roads_chain_regardless_of_point_order() {
        let mut a = fragment(1, 2, vec![[0.0, 0.0], [0.0, 1000.0]]);
        let mut b = fragment(2, 2, vec![[0.0, 2000.0], [0.0, 1000.0]]);
        for road in [&mut a, &mut b] {
            road.highway = "primary".into();
            road.lane_records[0].direction = "backward".into();
        }
        let corridors = build_corridors(&[a, b], &[junction(&[1, 2], [0.0, 1000.0])]);
        assert_eq!(corridors.len(), 1);
        assert_eq!(corridors[0].travel, Travel::TwoWay);
        assert_eq!(corridors[0].center_line.len(), 201 + 2 - 2 + 0, "resampled");
    }

    #[test]
    fn edge_lines_stop_where_they_enter_another_roads_pavement() {
        // Mainline occupies x in [-12, 12]; a ramp edge comes in from the
        // right and runs along inside the pavement.
        let mainline = fragment(1, 2, vec![[0.0, 0.0], [0.0, 2000.0]]);
        let corridors = build_corridors(&[mainline], &[]);
        let pavement = vec![corridors[0].surface_polygon(0.0)];
        let ramp_edge = vec![[200.0, 0.0], [62.0, 400.0], [6.0, 600.0], [6.0, 1200.0]];
        let pieces = clip_outside_polygons(&ramp_edge, &pavement);
        assert_eq!(pieces.len(), 1);
        let piece = &pieces[0];
        assert_eq!(piece[0], [200.0, 0.0]);
        let end = piece[piece.len() - 1];
        assert!(
            (end[0] - 12.0).abs() < 1e-6,
            "ends on the mainline edge: {end:?}"
        );
        assert!(end[1] > 400.0 && end[1] < 600.0);
        // A line passing through comes out as two pieces that stop on each edge.
        let through = vec![[-100.0, 1000.0], [100.0, 1000.0]];
        let pieces = clip_outside_polygons(&through, &pavement);
        assert_eq!(pieces.len(), 2);
        assert!(distance(pieces[0][1], [-12.0, 1000.0]) < 1e-6);
        assert!(distance(pieces[1][0], [12.0, 1000.0]) < 1e-6);
        // A line fully inside the pavement disappears.
        assert!(clip_outside_polygons(&[[0.0, 100.0], [0.0, 200.0]], &pavement).is_empty());
    }

    #[test]
    fn backward_fragments_are_oriented_with_traffic() {
        let mut backward = fragment(1, 2, vec![[0.0, 1000.0], [0.0, 0.0]]);
        for lane in &mut backward.lane_records {
            lane.direction = "backward".into();
        }
        let corridors = build_corridors(&[backward], &[]);
        let line = &corridors[0].center_line;
        assert!(line[0][1] < line[line.len() - 1][1]);
        // Driver's left of northbound travel is -x.
        assert!(corridors[0].left_edge()[0][0] < 0.0);
    }
}

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type Position = [f64; 2];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "coordinates")]
pub enum Geometry {
    LineString(Vec<Position>),
    Polygon(Vec<Vec<Position>>),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaneRecord {
    pub lane_type: String,
    pub direction: String,
    pub width_feet: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_evidence: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipRecord {
    pub road_ids: Vec<i64>,
    pub kind: String,
    pub source_node_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TopologyDiagnostic {
    pub kind: String,
    pub road_ids: Vec<i64>,
    pub source_way_ids: Vec<i64>,
    pub crossing_point: Position,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergeLaneZone {
    pub side: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geometry_side: Option<String>,
    pub start_arc_feet: f64,
    pub end_arc_feet: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NavigationRoad {
    pub topology_road_id: i64,
    pub source_way_ids: Vec<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub endpoint_node_ids: Vec<i64>,
    pub layer: i16,
    pub highway: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bridge: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tunnel: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lane_records: Vec<LaneRecord>,
    pub center_line: Vec<Position>,
    pub surface_polygon: Vec<Position>,
    pub width_feet: f64,
    pub trim_start_feet: f64,
    pub trim_end_feet: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_lane_zone: Option<MergeLaneZone>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NavigationIntersection {
    pub source_node_ids: Vec<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub connected_road_ids: Vec<i64>,
    pub layer: i16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relationship: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationships: Vec<RelationshipRecord>,
    pub polygon: Vec<Position>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NavigationMarking {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topology_road_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_way_ids: Vec<i64>,
    pub marking_type: String,
    pub layer: i16,
    pub geometry: Vec<Position>,
}

/// The normalized navigation-map snapshot described by the Version 9 bridge
/// contract, expressed in the same scene feet as [`RoadScene::features`] so a
/// renderer can consume it without re-deriving any transform.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NavigationMap {
    pub version: u8,
    pub provider: String,
    pub roads: Vec<NavigationRoad>,
    pub intersections: Vec<NavigationIntersection>,
    pub markings: Vec<NavigationMarking>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RoadFeatureKind {
    RoadCasing,
    RoadSurface,
    LeftFogLine,
    RightFogLine,
    SkipLine,
    ShoulderEdge,
    TrafficFlow,
    RampGore,
    DirectionArrow,
    RampSurfaceRibbon,
    RampCasingRibbon,
    AuxiliaryLaneLine,
    IntersectionSurface,
    SemanticMarking,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeatureProperties {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub osm_id: Option<i64>,
    /// Joins the feature back to its [`NavigationRoad`] and to the
    /// `connectedRoadIds` recorded on normalized intersections.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topology_road_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_way_ids: Vec<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub endpoint_node_ids: Vec<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lane_records: Vec<LaneRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relationship: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub connected_road_ids: Vec<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationships: Vec<RelationshipRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highway: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub junction_reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bridge: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tunnel: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lanes: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left_shoulder_width_feet: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right_shoulder_width_feet: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub render_width_feet: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marking_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoadFeature {
    pub id: String,
    pub kind: RoadFeatureKind,
    pub layer: i16,
    pub geometry: Geometry,
    pub properties: FeatureProperties,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SceneSourceType {
    OsmApi,
    OsmPbf,
    QgisSupplement,
    DevelopmentFixture,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SceneSource {
    #[serde(rename = "type")]
    pub source_type: SceneSourceType,
    pub dataset: String,
    pub generated_at: String,
    pub attribution: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoordinateSystem {
    pub world_crs: String,
    pub display_units: String,
    pub origin: String,
    pub traffic_flow: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Viewport {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoadScene {
    pub version: u8,
    pub source: SceneSource,
    pub coordinate_system: CoordinateSystem,
    pub viewport: Viewport,
    pub features: Vec<RoadFeature>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<TopologyDiagnostic>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub navigation_map: Option<NavigationMap>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_ipc_fields_in_frontend_shape() {
        let feature = RoadFeature {
            id: "way-1-surface".into(),
            kind: RoadFeatureKind::RoadSurface,
            layer: 2,
            geometry: Geometry::LineString(vec![[0.0, 0.0], [10.0, 10.0]]),
            properties: FeatureProperties {
                osm_id: Some(1),
                render_width_feet: Some(36.0),
                ..FeatureProperties::default()
            },
        };

        let json = serde_json::to_value(feature).expect("feature should serialize");
        assert_eq!(json["kind"], "road-surface");
        assert_eq!(json["properties"]["osmId"], 1);
        assert_eq!(json["properties"]["renderWidthFeet"], 36.0);
    }
}

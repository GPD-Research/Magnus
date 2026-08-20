use serde::{Deserialize, Serialize};

pub type Position = [f64; 2];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "coordinates")]
pub enum Geometry {
    LineString(Vec<Position>),
    Polygon(Vec<Vec<Position>>),
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
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeatureProperties {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub osm_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highway: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bridge: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tunnel: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lanes: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub render_width_feet: Option<f64>,
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

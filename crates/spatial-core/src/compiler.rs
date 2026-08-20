use std::{collections::HashMap, path::Path};

use osmpbf::{Element, ElementReader};
use thiserror::Error;

use crate::{
    CoordinateSystem, FeatureProperties, Geometry, RoadFeature, RoadFeatureKind, RoadScene,
    SceneSource, SceneSourceType, Viewport,
};

const FEET_PER_METER: f64 = 3.280_839_895;

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
}

#[derive(Debug)]
struct WayRecord {
    id: i64,
    refs: Vec<i64>,
    highway: String,
    name: Option<String>,
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
            ways.push(WayRecord {
                id: way.id(),
                refs: way.refs().collect(),
                highway: (*highway).to_owned(),
                name: tags.get("name").map(|value| (*value).to_owned()),
                layer: tags
                    .get("layer")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0),
                bridge: tags.get("bridge").is_some_and(|value| *value != "no"),
                tunnel: tags.get("tunnel").is_some_and(|value| *value != "no"),
                lanes,
                direction: if tags.get("oneway").is_some_and(|value| *value == "-1") {
                    "backward".into()
                } else {
                    "forward".into()
                },
            });
        }
    })?;

    let mut features = Vec::new();
    for way in ways {
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
            name: way.name,
            highway: Some(way.highway),
            bridge: Some(way.bridge),
            tunnel: Some(way.tunnel),
            lanes: Some(way.lanes),
            direction: Some(way.direction),
            render_width_feet: Some(width),
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
    })
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
}

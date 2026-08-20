use rstar::{AABB, RTree, RTreeObject};

use crate::{Geometry, RoadFeature};

#[derive(Debug, Clone)]
struct IndexedFeature {
    feature_index: usize,
    envelope: AABB<[f64; 2]>,
}

impl RTreeObject for IndexedFeature {
    type Envelope = AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        self.envelope
    }
}

#[derive(Debug)]
pub struct SpatialFeatureIndex {
    tree: RTree<IndexedFeature>,
}

impl SpatialFeatureIndex {
    #[must_use]
    pub fn new(features: &[RoadFeature]) -> Self {
        let indexed = features
            .iter()
            .enumerate()
            .filter_map(|(feature_index, feature)| {
                geometry_envelope(&feature.geometry).map(|envelope| IndexedFeature {
                    feature_index,
                    envelope,
                })
            })
            .collect();
        Self {
            tree: RTree::bulk_load(indexed),
        }
    }

    #[must_use]
    pub fn query(&self, bounds: [f64; 4]) -> Vec<usize> {
        let envelope = AABB::from_corners([bounds[0], bounds[1]], [bounds[2], bounds[3]]);
        self.tree
            .locate_in_envelope_intersecting(&envelope)
            .map(|item| item.feature_index)
            .collect()
    }
}

fn geometry_envelope(geometry: &Geometry) -> Option<AABB<[f64; 2]>> {
    let points: Vec<[f64; 2]> = match geometry {
        Geometry::LineString(points) => points.clone(),
        Geometry::Polygon(rings) => rings.iter().flatten().copied().collect(),
    };
    let first = *points.first()?;
    let mut lower = first;
    let mut upper = first;
    for point in points.iter().skip(1) {
        lower[0] = lower[0].min(point[0]);
        lower[1] = lower[1].min(point[1]);
        upper[0] = upper[0].max(point[0]);
        upper[1] = upper[1].max(point[1]);
    }
    Some(AABB::from_corners(lower, upper))
}

#[cfg(test)]
mod tests {
    use crate::{FeatureProperties, Geometry, RoadFeature, RoadFeatureKind};

    use super::*;

    #[test]
    fn finds_only_features_intersecting_a_viewport() {
        let features = vec![
            RoadFeature {
                id: "near".into(),
                kind: RoadFeatureKind::RoadSurface,
                layer: 0,
                geometry: Geometry::LineString(vec![[0.0, 0.0], [100.0, 100.0]]),
                properties: FeatureProperties::default(),
            },
            RoadFeature {
                id: "far".into(),
                kind: RoadFeatureKind::RoadSurface,
                layer: 0,
                geometry: Geometry::LineString(vec![[1_000.0, 1_000.0], [1_100.0, 1_100.0]]),
                properties: FeatureProperties::default(),
            },
        ];

        let index = SpatialFeatureIndex::new(&features);
        assert_eq!(index.query([-10.0, -10.0, 150.0, 150.0]), vec![0]);
    }
}

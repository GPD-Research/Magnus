use osmpbf::{Element, ElementReader};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Represents a parsed highway segment from OSM PBF data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HighwaySegment {
    pub id: i64,
    pub layer: i8,
    pub lanes: u8,
    pub is_bridge: bool,
    pub is_tunnel: bool,
    pub oneway: bool,
    pub highway_class: String,
    pub name: Option<String>,
    pub reference: Option<String>,
    pub coordinates: Vec<(f64, f64)>,
}

/// Bounding-box filter: returns true when the coordinate falls within the box.
fn in_bbox(lon: f64, lat: f64, min_lon: f64, min_lat: f64, max_lon: f64, max_lat: f64) -> bool {
    lon >= min_lon && lon <= max_lon && lat >= min_lat && lat <= max_lat
}

/// Parse a `.pbf` file and return all highway ways clipped to the supplied bbox,
/// sorted by their topological `layer` tag (ground → highest flyover).
pub fn parse_pbf_bbox(
    pbf_path: &str,
    min_lon: f64,
    min_lat: f64,
    max_lon: f64,
    max_lat: f64,
) -> Result<Vec<HighwaySegment>, osmpbf::Error> {
    let reader = ElementReader::from_path(Path::new(pbf_path))?;

    // First pass: collect all node id → (lon, lat) pairs so ways can resolve coords.
    let mut node_coords: std::collections::HashMap<i64, (f64, f64)> = std::collections::HashMap::new();

    reader.for_each(|element| match element {
        Element::Node(n) => {
            node_coords.insert(n.id(), (n.lon(), n.lat()));
        }
        Element::DenseNode(n) => {
            node_coords.insert(n.id(), (n.lon(), n.lat()));
        }
        _ => {}
    })?;

    let mut segments: Vec<HighwaySegment> = Vec::new();

    // Second read: resolve ways with node references properly.
    let reader2 = ElementReader::from_path(Path::new(pbf_path))?;
    reader2.for_each(|element| {
        if let Element::Way(way) = element {
            let mut is_highway = false;
            let mut highway_class = String::new();
            let mut layer: i8 = 0;
            let mut lanes: u8 = 1;
            let mut is_bridge = false;
            let mut is_tunnel = false;
            let mut oneway = false;
            let mut name: Option<String> = None;
            let mut reference: Option<String> = None;

            for (k, v) in way.tags() {
                match k {
                    "highway" => {
                        is_highway = true;
                        highway_class = v.to_string();
                    }
                    "layer" => layer = v.parse::<i8>().unwrap_or(0),
                    "lanes" => lanes = v.parse::<u8>().unwrap_or(1),
                    "bridge" if v == "yes" => is_bridge = true,
                    "tunnel" if v == "yes" => is_tunnel = true,
                    "oneway" if v == "yes" => oneway = true,
                    "name" => name = Some(v.to_string()),
                    "ref" => reference = Some(v.to_string()),
                    _ => {}
                }
            }

            if !is_highway
                || !matches!(
                    highway_class.as_str(),
                    "motorway"
                        | "motorway_link"
                        | "trunk"
                        | "trunk_link"
                        | "primary"
                        | "primary_link"
                        | "secondary"
                        | "secondary_link"
                )
            {
                return;
            }

            let coords: Vec<(f64, f64)> = way
                .refs()
                .filter_map(|node_id| node_coords.get(&node_id).copied())
                .collect();

            // Bbox clip: keep segment if any node falls within the bbox.
            let in_box = coords
                .iter()
                .any(|(lon, lat)| in_bbox(*lon, *lat, min_lon, min_lat, max_lon, max_lat));

            if in_box && !coords.is_empty() {
                segments.push(HighwaySegment {
                    id: way.id(),
                    layer,
                    lanes,
                    is_bridge,
                    is_tunnel,
                    oneway,
                    highway_class,
                    name,
                    reference,
                    coordinates: coords,
                });
            }
        }
    })?;

    // Sort by topological layer (ground=0 first, then flyovers ascending).
    segments.sort_by_key(|s| s.layer);

    Ok(segments)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_in_bbox() {
        assert!(in_bbox(-77.2, 38.8, -77.55, 38.60, -77.00, 39.00));
        assert!(!in_bbox(-78.0, 38.8, -77.55, 38.60, -77.00, 39.00));
        assert!(!in_bbox(-77.2, 39.5, -77.55, 38.60, -77.00, 39.00));
    }

    #[test]
    fn test_segment_sort_order() {
        let mut segs = vec![
            HighwaySegment {
                id: 1, layer: 2, lanes: 2, is_bridge: true, is_tunnel: false,
                oneway: true, highway_class: "motorway".into(),
                name: None, reference: None, coordinates: vec![],
            },
            HighwaySegment {
                id: 2, layer: 0, lanes: 3, is_bridge: false, is_tunnel: false,
                oneway: false, highway_class: "primary".into(),
                name: None, reference: None, coordinates: vec![],
            },
            HighwaySegment {
                id: 3, layer: 1, lanes: 2, is_bridge: true, is_tunnel: false,
                oneway: true, highway_class: "trunk".into(),
                name: None, reference: None, coordinates: vec![],
            },
        ];
        segs.sort_by_key(|s| s.layer);
        assert_eq!(segs[0].layer, 0);
        assert_eq!(segs[1].layer, 1);
        assert_eq!(segs[2].layer, 2);
    }
}

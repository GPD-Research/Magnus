use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TravelDirection {
    Northbound,
    Southbound,
    Eastbound,
    Westbound,
    All,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RoadReferenceType {
    MileMarker,
    Exit,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoadLocationRequest {
    pub highway: String,
    pub direction: TravelDirection,
    pub reference_type: RoadReferenceType,
    pub reference: String,
}

impl RoadLocationRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.highway.trim().is_empty() || self.highway.len() > 32 {
            return Err("highway must contain between 1 and 32 characters");
        }
        if self.reference.trim().is_empty() || self.reference.len() > 16 {
            return Err("reference must contain between 1 and 16 characters");
        }
        Ok(())
    }

    #[must_use]
    pub fn overpass_query(&self) -> String {
        let route_pattern = highway_ref_pattern(&self.highway);
        let reference = overpass_regex_escape(self.reference.trim());
        let anchor_filter = match self.reference_type {
            RoadReferenceType::Exit => format!(
                "node(area.searchArea)[\"highway\"=\"motorway_junction\"][\"ref\"~\"^{reference}[A-Za-z]?$\",i]"
            ),
            RoadReferenceType::MileMarker => format!(
                "node(area.searchArea)[\"highway\"=\"milestone\"][\"distance\"~\"^{reference}(\\.0)?$\",i]"
            ),
        };

        format!(
            "[out:json][timeout:25];\narea[\"ISO3166-2\"=\"US-VA\"][\"admin_level\"=\"4\"]->.searchArea;\n{anchor_filter}->.candidateAnchors;\nway(around.candidateAnchors:250)[\"highway\"][\"ref\"~\"{route_pattern}\",i]->.routeWays;\nnode.candidateAnchors(around.routeWays:100)->.anchors;\nway(around.anchors:2500)[\"highway\"~\"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link)$\"]->.nearbyWays;\n(.anchors;.routeWays;.nearbyWays;>;);\nout body;"
        )
    }
}

fn highway_ref_pattern(highway: &str) -> String {
    let normalized = highway.trim().to_uppercase().replace('.', "");
    let compact = normalized.replace([' ', '-'], "");
    if let Some(number) = compact.strip_prefix('I').filter(|value| is_route_number(value)) {
        return format!("^I[ -]?{}$", overpass_regex_escape(number));
    }
    let route_number = compact
        .strip_prefix("ROUTE")
        .or_else(|| compact.strip_prefix("RT"))
        .filter(|value| is_route_number(value));
    if let Some(number) = route_number {
        return format!(
            "^(VA|SR|ROUTE|RT)[ -]?{}$",
            overpass_regex_escape(number)
        );
    }
    format!("^{}$", overpass_regex_escape(highway.trim()))
}

fn is_route_number(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|character| character.is_ascii_alphanumeric())
}

fn overpass_regex_escape(value: &str) -> String {
    value.chars().fold(String::new(), |mut escaped, character| {
        if matches!(
            character,
            '\\' | '.' | '+' | '*' | '?' | '(' | ')' | '[' | ']' | '{' | '}' | '^' | '$' | '|'
        ) {
            escaped.push_str("\\\\");
        }
        if character == '"' {
            escaped.push_str("\\\"");
        } else if character == '\n' || character == '\r' {
            escaped.push(' ');
        } else {
            escaped.push(character);
        }
        escaped
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(highway: &str, reference_type: RoadReferenceType) -> RoadLocationRequest {
        RoadLocationRequest {
            highway: highway.into(),
            direction: TravelDirection::Northbound,
            reference_type,
            reference: "166".into(),
        }
    }

    #[test]
    fn builds_an_interstate_exit_query_against_osm_tags() {
        let query = request("I-95", RoadReferenceType::Exit).overpass_query();

        assert!(query.contains("[\"highway\"=\"motorway_junction\"]"));
        assert!(query.contains("[\"ref\"~\"^166[A-Za-z]?$\",i]"));
        assert!(query.contains("[\"ref\"~\"^I[ -]?95$\",i]"));
        assert!(query.contains("way(around.candidateAnchors:250)"));
        assert!(query.contains("node.candidateAnchors(around.routeWays:100)->.anchors"));
        assert!(query.contains("way(around.anchors:2500)"));
    }

    #[test]
    fn maps_human_route_aliases_to_virginia_osm_refs() {
        let query = request("Rt 28", RoadReferenceType::MileMarker).overpass_query();

        assert!(query.contains("[\"highway\"=\"milestone\"]"));
        assert!(query.contains("^(VA|SR|ROUTE|RT)[ -]?28$"));
    }

    #[test]
    fn escapes_reference_text_before_inserting_it_into_overpass_ql() {
        let query = RoadLocationRequest {
            reference: "166\"] ; out geom; //".into(),
            ..request("I-95", RoadReferenceType::Exit)
        }
        .overpass_query();

        assert!(!query.contains("[\"ref\"~\"^166\"] ; out geom; //"));
        assert!(query.contains(r#"166\"\\]"#));
        assert!(!query.contains("; out geom; //\"->.anchors"));
    }

    #[test]
    fn rejects_empty_or_unreasonably_long_query_fields() {
        let mut location = request("", RoadReferenceType::Exit);
        assert_eq!(location.validate(), Err("highway must contain between 1 and 32 characters"));

        location.highway = "I-95".into();
        location.reference = "".into();
        assert_eq!(location.validate(), Err("reference must contain between 1 and 16 characters"));
    }
}
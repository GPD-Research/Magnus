use std::{
    collections::{HashMap, hash_map::DefaultHasher},
    env,
    hash::{Hash, Hasher},
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
};
use magnus_spatial_core::{
    Geometry, RoadFeatureKind, RoadLocationRequest, RoadScene, compile_overpass_json,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, RwLock, oneshot};
use tower_http::services::{ServeDir, ServeFile};

const DEFAULT_OVERPASS_URLS: [&str; 3] = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
];
const CACHE_VERSION: &str = "road-scene-v6";
const LEGACY_CACHE_VERSIONS: [&str; 2] = ["road-scene-v4", "road-scene-v3"];

#[derive(Clone)]
struct AppState {
    client: reqwest::Client,
    overpass_urls: Vec<String>,
    scene_cache: Arc<RwLock<HashMap<String, RoadScene>>>,
    cache_directory: PathBuf,
    shutdown_sender: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

#[derive(Serialize)]
struct ApiError {
    error: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum SceneSourceMode {
    #[default]
    Online,
    Lan,
    Offline,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveRoadSceneQuery {
    #[serde(flatten)]
    location: RoadLocationRequest,
    #[serde(default)]
    source: SceneSourceMode,
}

#[derive(Deserialize)]
struct PrepareOfflineRequest {
    region: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OfflineRegionStatus {
    id: &'static str,
    label: &'static str,
    installed: bool,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OfflineStatus {
    regions: Vec<OfflineRegionStatus>,
    cached_scenes: usize,
    cache_bytes: u64,
}

type ApiResult<T> = Result<Json<T>, (StatusCode, Json<ApiError>)>;

#[tokio::main]
async fn main() -> Result<()> {
    let address: SocketAddr = env::var("MAGNUS_SPATIAL_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8787".into())
        .parse()
        .context("MAGNUS_SPATIAL_ADDR must be a socket address")?;
    let (shutdown_sender, shutdown_receiver) = oneshot::channel();
    let state = AppState {
        client: reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .user_agent("Magnus SSP Scene Builder/4.0-rc.1")
            .build()?,
        overpass_urls: configured_overpass_urls(),
        scene_cache: Arc::new(RwLock::new(HashMap::new())),
        cache_directory: env::var("MAGNUS_ROAD_CACHE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("target/magnus-road-cache")),
        shutdown_sender: Arc::new(Mutex::new(Some(shutdown_sender))),
    };
    let web_directory = env::var("MAGNUS_WEB_DIR").unwrap_or_else(|_| "dist".into());
    let index_file = format!("{web_directory}/index.html");
    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/exit", post(exit_application))
        .route("/api/road-scenes/resolve", get(resolve_road_scene))
        .route("/api/offline/status", get(offline_status))
        .route("/api/offline/prepare", post(prepare_offline_region))
        .with_state(state)
        .fallback_service(
            ServeDir::new(web_directory).not_found_service(ServeFile::new(index_file)),
        );
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!("Magnus listening on http://{address}");
    axum::serve(listener, app)
        .with_graceful_shutdown(async { let _ = shutdown_receiver.await; })
        .await?;
    Ok(())
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "magnus-spatial",
    })
}

async fn exit_application(State(state): State<AppState>) -> StatusCode {
    let sender = state.shutdown_sender.lock().await.take();
    tokio::spawn(async move {
        tokio::task::yield_now().await;
        if let Some(sender) = sender {
            let _ = sender.send(());
        }
    });
    StatusCode::ACCEPTED
}

async fn resolve_road_scene(
    State(state): State<AppState>,
    Query(query): Query<ResolveRoadSceneQuery>,
) -> ApiResult<RoadScene> {
    let source_mode = query.source;
    let request = query.location;
    request
        .validate()
        .map_err(|message| api_error(StatusCode::BAD_REQUEST, message))?;
    let overpass_query = request.overpass_query();
    let cache_key = scene_cache_key(&overpass_query);
    if let Some(scene) = state.scene_cache.read().await.get(&cache_key).cloned() {
        return Ok(Json(scene));
    }
    if let Some(scene) = read_cached_scene(&state.cache_directory, &cache_key).await {
        state
            .scene_cache
            .write()
            .await
            .insert(cache_key, scene.clone());
        return Ok(Json(scene));
    }
    if let Some(scene) = read_legacy_cached_scene(&state.cache_directory, &overpass_query).await {
        state
            .scene_cache
            .write()
            .await
            .insert(cache_key.clone(), scene.clone());
        write_cached_scene(&state.cache_directory, &cache_key, &scene).await;
        return Ok(Json(scene));
    }

    if source_mode != SceneSourceMode::Online {
        return Err(api_error(
            StatusCode::PRECONDITION_FAILED,
            "this location is not prepared for local use; switch to Online or prepare it while connected",
        ));
    }

    let mut failures = Vec::new();
    let route_geometry_query = request.route_geometry_query();
    let prefer_route_geometry = request.prefers_route_geometry_query();
    let provider_attempts = state
        .overpass_urls
        .iter()
        .chain(state.overpass_urls.first());
    for (index, overpass_url) in provider_attempts.enumerate() {
        let query_attempts = if prefer_route_geometry {
            [route_geometry_query.as_deref(), Some(overpass_query.as_str())]
        } else {
            [Some(overpass_query.as_str()), route_geometry_query.as_deref()]
        };
        for (query, attempt_label) in query_attempts
            .into_iter()
            .zip(if prefer_route_geometry {
                ["route fallback", "exact lookup"]
            } else {
                ["exact lookup", "route fallback"]
            })
        {
            let Some(query) = query else { continue };
            let response = match state
                .client
                .post(overpass_url)
                .form(&[("data", query)])
                .send()
                .await
            {
                Ok(response) => response,
                Err(error) => {
                    failures.push(format!("provider {} {attempt_label} request failed: {error}", index + 1));
                    continue;
                }
            };
            if !response.status().is_success() {
                failures.push(format!(
                    "provider {} {attempt_label} returned {}",
                    index + 1,
                    response.status()
                ));
                continue;
            }
            let body = match response.text().await {
                Ok(body) => body,
                Err(error) => {
                    failures.push(format!("provider {} {attempt_label} response failed: {error}", index + 1));
                    continue;
                }
            };
            let scene = match compile_overpass_json(&body, &request) {
                Ok(scene) => scene,
                Err(error) => {
                    failures.push(format!("provider {} {attempt_label} data failed: {error}", index + 1));
                    continue;
                }
            };
            state
                .scene_cache
                .write()
                .await
                .insert(cache_key.clone(), scene.clone());
            write_cached_scene(&state.cache_directory, &cache_key, &scene).await;
            return Ok(Json(scene));
        }
    }

    Err(api_error(
        StatusCode::BAD_GATEWAY,
        &format!("all map providers failed: {}", failures.join("; ")),
    ))
}

async fn offline_status(State(state): State<AppState>) -> Json<OfflineStatus> {
    let regions = [
        ("northern-virginia", "Northern Virginia highways", Path::new("data/processed/nova-highways.osm.pbf")),
        ("virginia", "Virginia statewide source", Path::new("data/raw/virginia-latest.osm.pbf")),
    ];
    let mut statuses = Vec::new();
    for (id, label, path) in regions {
        let metadata = tokio::fs::metadata(path).await.ok();
        statuses.push(OfflineRegionStatus {
            id,
            label,
            installed: metadata.is_some(),
            bytes: metadata.map_or(0, |value| value.len()),
        });
    }
    let (cached_scenes, cache_bytes) = directory_inventory(&state.cache_directory).await;
    Json(OfflineStatus { regions: statuses, cached_scenes, cache_bytes })
}

async fn prepare_offline_region(
    State(state): State<AppState>,
    Json(request): Json<PrepareOfflineRequest>,
) -> Result<Json<OfflineStatus>, (StatusCode, Json<ApiError>)> {
    if !matches!(request.region.as_str(), "northern-virginia" | "virginia") {
        return Err(api_error(StatusCode::BAD_REQUEST, "unsupported offline region"));
    }
    let output = tokio::process::Command::new("bash")
        .arg("scripts/prepare-nova-data.sh")
        .arg(&request.region)
        .output()
        .await
        .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, &format!("offline preparation could not start: {error}")))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr);
        return Err(api_error(StatusCode::BAD_GATEWAY, message.trim()));
    }
    Ok(offline_status(State(state)).await)
}

async fn directory_inventory(directory: &Path) -> (usize, u64) {
    let Ok(mut entries) = tokio::fs::read_dir(directory).await else {
        return (0, 0);
    };
    let mut count = 0;
    let mut bytes = 0;
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        if let Ok(metadata) = entry.metadata().await {
            count += 1;
            bytes += metadata.len();
        }
    }
    (count, bytes)
}

fn configured_overpass_urls() -> Vec<String> {
    let configured = env::var("OVERPASS_URLS")
        .ok()
        .or_else(|| env::var("OVERPASS_URL").ok());
    parse_overpass_urls(configured.as_deref())
}

fn parse_overpass_urls(configured: Option<&str>) -> Vec<String> {
    configured
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|url| !url.is_empty())
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .filter(|urls| !urls.is_empty())
        .unwrap_or_else(|| {
            DEFAULT_OVERPASS_URLS
                .iter()
                .map(ToString::to_string)
                .collect()
        })
}

fn scene_cache_key(query: &str) -> String {
    scene_cache_key_for_version(CACHE_VERSION, query)
}

fn scene_cache_key_for_version(version: &str, query: &str) -> String {
    let mut hasher = DefaultHasher::new();
    version.hash(&mut hasher);
    query.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

async fn read_cached_scene(directory: &Path, cache_key: &str) -> Option<RoadScene> {
    let bytes = tokio::fs::read(directory.join(format!("{cache_key}.json")))
        .await
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

async fn read_legacy_cached_scene(directory: &Path, query: &str) -> Option<RoadScene> {
    for version in LEGACY_CACHE_VERSIONS {
        let cache_key = scene_cache_key_for_version(version, query);
        if let Some(mut scene) = read_cached_scene(directory, &cache_key).await {
            if version == "road-scene-v3" {
                upgrade_v3_fog_lines(&mut scene);
            }
            scene.source.attribution.push_str("; restored from local map cache");
            return Some(scene);
        }
    }
    None
}

fn upgrade_v3_fog_lines(scene: &mut RoadScene) {
    let centerlines: HashMap<String, Vec<[f64; 2]>> = scene
        .features
        .iter()
        .filter_map(|feature| {
            if feature.kind != RoadFeatureKind::RoadSurface {
                return None;
            }
            let Geometry::LineString(points) = &feature.geometry else {
                return None;
            };
            Some((feature.id.clone(), points.clone()))
        })
        .collect();

    for feature in &mut scene.features {
        if !matches!(
            feature.kind,
            RoadFeatureKind::LeftFogLine | RoadFeatureKind::RightFogLine
        ) {
            continue;
        }
        let Some(prefix) = feature
            .id
            .strip_suffix("-left-edge")
            .or_else(|| feature.id.strip_suffix("-right-edge"))
        else {
            continue;
        };
        let Some(centerline) = centerlines.get(&format!("{prefix}-surface")) else {
            continue;
        };
        let Geometry::LineString(points) = &mut feature.geometry else {
            continue;
        };
        for (point, center) in points.iter_mut().zip(centerline) {
            let delta_x = point[0] - center[0];
            let delta_y = point[1] - center[1];
            let distance = delta_x.hypot(delta_y);
            if distance > 0.0 {
                point[0] += delta_x / distance;
                point[1] += delta_y / distance;
            }
        }
    }
}

async fn write_cached_scene(directory: &Path, cache_key: &str, scene: &RoadScene) {
    let Ok(bytes) = serde_json::to_vec(scene) else {
        return;
    };
    if tokio::fs::create_dir_all(directory).await.is_err() {
        return;
    }
    let _ = tokio::fs::write(directory.join(format!("{cache_key}.json")), bytes).await;
}

fn api_error(status: StatusCode, message: &str) -> (StatusCode, Json<ApiError>) {
    (
        status,
        Json(ApiError {
            error: message.into(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_configured_provider_pool() {
        assert_eq!(
            parse_overpass_urls(Some("https://one.test/api, https://two.test/api")),
            vec!["https://one.test/api", "https://two.test/api"]
        );
    }

    #[test]
    fn cache_keys_change_with_the_query() {
        assert_eq!(scene_cache_key("query one"), scene_cache_key("query one"));
        assert_ne!(scene_cache_key("query one"), scene_cache_key("query two"));
        assert_ne!(
            scene_cache_key_for_version("road-scene-v3", "query one"),
            scene_cache_key("query one")
        );
    }

    #[test]
    fn local_modes_are_distinct_from_online_resolution() {
        assert_ne!(SceneSourceMode::Offline, SceneSourceMode::Online);
        assert_ne!(SceneSourceMode::Lan, SceneSourceMode::Online);
    }

    #[test]
    fn upgrades_cached_fog_lines_to_the_true_lane_edge() {
        let properties = magnus_spatial_core::FeatureProperties::default();
        let mut scene = RoadScene {
            version: 1,
            source: magnus_spatial_core::SceneSource {
                source_type: magnus_spatial_core::SceneSourceType::OsmApi,
                dataset: "cached".into(),
                generated_at: "cached".into(),
                attribution: "OSM".into(),
            },
            coordinate_system: magnus_spatial_core::CoordinateSystem {
                world_crs: "LOCAL".into(),
                display_units: "feet".into(),
                origin: "top-left".into(),
                traffic_flow: "bottom-to-top".into(),
            },
            viewport: magnus_spatial_core::Viewport { width: 100.0, height: 100.0 },
            features: vec![
                magnus_spatial_core::RoadFeature {
                    id: "way-1-0-surface".into(),
                    kind: RoadFeatureKind::RoadSurface,
                    layer: 0,
                    geometry: Geometry::LineString(vec![[50.0, 90.0], [50.0, 10.0]]),
                    properties: properties.clone(),
                },
                magnus_spatial_core::RoadFeature {
                    id: "way-1-0-right-edge".into(),
                    kind: RoadFeatureKind::RightFogLine,
                    layer: 1,
                    geometry: Geometry::LineString(vec![[67.0, 90.0], [67.0, 10.0]]),
                    properties,
                },
            ],
        };

        upgrade_v3_fog_lines(&mut scene);

        assert_eq!(
            scene.features[1].geometry,
            Geometry::LineString(vec![[68.0, 90.0], [68.0, 10.0]])
        );
    }
}

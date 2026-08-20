use std::{env, net::SocketAddr, time::Duration};

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    routing::get,
};
use magnus_spatial_core::{RoadLocationRequest, RoadScene, compile_overpass_json};
use serde::Serialize;

const DEFAULT_OVERPASS_URL: &str = "https://overpass-api.de/api/interpreter";

#[derive(Clone)]
struct AppState {
    client: reqwest::Client,
    overpass_url: String,
}

#[derive(Serialize)]
struct ApiError {
    error: String,
}

type ApiResult<T> = Result<Json<T>, (StatusCode, Json<ApiError>)>;

#[tokio::main]
async fn main() -> Result<()> {
    let address: SocketAddr = env::var("MAGNUS_SPATIAL_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8787".into())
        .parse()
        .context("MAGNUS_SPATIAL_ADDR must be a socket address")?;
    let state = AppState {
        client: reqwest::Client::builder()
            .timeout(Duration::from_secs(35))
            .user_agent("Magnus SSP Scene Builder/0.1")
            .build()?,
        overpass_url: env::var("OVERPASS_URL").unwrap_or_else(|_| DEFAULT_OVERPASS_URL.into()),
    };
    let app = Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/road-scenes/resolve", get(resolve_road_scene))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!("Magnus spatial API listening on http://{address}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn resolve_road_scene(
    State(state): State<AppState>,
    Query(request): Query<RoadLocationRequest>,
) -> ApiResult<RoadScene> {
    request.validate().map_err(|message| api_error(StatusCode::BAD_REQUEST, message))?;
    let query = request.overpass_query();
    let response = state
        .client
        .post(&state.overpass_url)
        .form(&[("data", query)])
        .send()
        .await
        .map_err(|error| api_error(StatusCode::BAD_GATEWAY, &format!("map query failed: {error}")))?;
    if !response.status().is_success() {
        return Err(api_error(
            StatusCode::BAD_GATEWAY,
            &format!("map provider returned {}", response.status()),
        ));
    }
    let body = response
        .text()
        .await
        .map_err(|error| api_error(StatusCode::BAD_GATEWAY, &format!("map response failed: {error}")))?;
    let scene = compile_overpass_json(&body, &request)
        .map_err(|error| api_error(StatusCode::NOT_FOUND, &error.to_string()))?;
    Ok(Json(scene))
}

fn api_error(status: StatusCode, message: &str) -> (StatusCode, Json<ApiError>) {
    (status, Json(ApiError { error: message.into() }))
}
//! Proxied GitHub HTTP for the frontend.
//!
//! WKWebView fetch to github.com fails with CORS ("Load failed"). Route those
//! calls through Rust so OAuth + Contents API work from the desktop app.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

const USER_AGENT: &str = "HyperStudio-Desktop";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubHttpResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubHttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

fn assert_allowed_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| format!("Invalid URL: {error}"))?;
    if parsed.scheme() != "https" {
        return Err("Only https GitHub URLs are allowed.".into());
    }
    match parsed.host_str() {
        Some("github.com") | Some("api.github.com") => Ok(()),
        other => Err(format!(
            "Host not allowed for GitHub proxy: {}",
            other.unwrap_or("<none>")
        )),
    }
}

#[tauri::command]
pub async fn github_http(request: GithubHttpRequest) -> Result<GithubHttpResponse, String> {
    assert_allowed_url(&request.url)?;

    let method = request.method.trim().to_uppercase();
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| format!("HTTP client failed: {error}"))?;

    let mut builder = match method.as_str() {
        "GET" => client.get(&request.url),
        "POST" => client.post(&request.url),
        "PUT" => client.put(&request.url),
        "PATCH" => client.patch(&request.url),
        "DELETE" => client.delete(&request.url),
        other => return Err(format!("Unsupported HTTP method: {other}")),
    };

    // GitHub requires a User-Agent; also set it explicitly on the request.
    builder = builder.header(reqwest::header::USER_AGENT, USER_AGENT);

    if let Some(headers) = &request.headers {
        for (key, value) in headers {
            if key.eq_ignore_ascii_case("user-agent") {
                continue;
            }
            builder = builder.header(key, value);
        }
    }

    if let Some(body) = &request.body {
        builder = builder.body(body.clone());
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("GitHub request failed: {error}"))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| format!("GitHub response body failed: {error}"))?;

    Ok(GithubHttpResponse { status, body })
}

//! All Anthropic API traffic goes through here. The UI hands over a request; this side
//! checks the destination, adds the API key from the keychain, swaps in app tokens, and
//! streams the response back over a channel. The key never enters the web view.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::ipc::Channel;
use tauri::State;

use crate::secrets;

const ALLOWED_PREFIX: &str = "https://api.anthropic.com/";
const SECRET_REF: &str = "aura-secret://";

/// The one local model server Page Aura talks to: Ollama on its default port, on this computer.
/// Only the two requests the app makes are allowed (`GET /api/tags` to list models and
/// `POST /v1/messages` to chat): plain http, no credentials, no query string, no other path or
/// method. A page script therefore can't use this command to reach other services on localhost.
/// These requests never get the Anthropic key or app tokens.
const LOCAL_PORT: u16 = 11434;

fn is_local_model_request(url: &str, method: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else { return false };
    u.scheme() == "http"
        && u.username().is_empty()
        && u.password().is_none()
        && matches!(u.host_str(), Some("localhost") | Some("127.0.0.1"))
        && u.port() == Some(LOCAL_PORT)
        && u.query().is_none()
        && u.fragment().is_none()
        && matches!((u.path(), method), ("/api/tags", "GET") | ("/v1/messages", "POST"))
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum FetchEvent {
    Head { status: u16, headers: Vec<(String, String)> },
    Chunk { b64: String },
    End,
    Error { message: String },
}

#[derive(Default)]
pub struct Inflight(Mutex<HashMap<u32, tokio::task::AbortHandle>>);

fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .user_agent(concat!("PageAura-Desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client")
    })
}

/// For the local model server: never follow a redirect, so it can't bounce a request elsewhere.
fn local_client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("PageAura-Desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("local http client")
    })
}

/// Replaces `"aura-secret://<id>"` placeholders inside a JSON body with the app token
/// stored in the keychain (JSON-escaped). Used for connected-app (MCP) tokens.
fn substitute_secrets(body: Vec<u8>) -> Result<Vec<u8>, String> {
    let Ok(text) = String::from_utf8(body.clone()) else { return Ok(body) };
    if !text.contains(SECRET_REF) {
        return Ok(body);
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text.as_str();
    while let Some(pos) = rest.find(SECRET_REF) {
        out.push_str(&rest[..pos]);
        let after = &rest[pos + SECRET_REF.len()..];
        let id_len = after.find(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).unwrap_or(after.len());
        let id = &after[..id_len];
        let name = secrets::app_secret_name(id).ok_or("invalid app reference")?;
        let token = secrets::get(&name).ok_or_else(|| format!("No token saved for app {id}"))?;
        let escaped = serde_json::to_string(&token).map_err(|e| e.to_string())?;
        out.push_str(&escaped[1..escaped.len() - 1]);
        rest = &after[id_len..];
    }
    out.push_str(rest);
    Ok(out.into_bytes())
}

#[tauri::command]
pub async fn api_fetch(
    state: State<'_, Inflight>,
    id: u32,
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    on_event: Channel<FetchEvent>,
) -> Result<(), String> {
    let local = is_local_model_request(&url, &method.to_ascii_uppercase());
    if !local && !url.starts_with(ALLOWED_PREFIX) {
        return Err("Blocked: Page Aura only talks to api.anthropic.com or Ollama on this computer (http://localhost:11434)".into());
    }
    let key = if local { None } else { Some(secrets::api_key().ok_or("No API key saved. Add it in Settings.")?) };
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = if local { local_client() } else { client() }.request(method, &url);
    for (k, v) in headers {
        let lk = k.to_ascii_lowercase();
        if matches!(lk.as_str(), "x-api-key" | "authorization" | "host" | "content-length" | "cookie" | "connection") {
            continue;
        }
        // Local requests carry only what Ollama needs (no Origin, Anthropic or other headers).
        if local && !matches!(lk.as_str(), "content-type" | "accept") {
            continue;
        }
        req = req.header(k, v);
    }
    if let Some(key) = key {
        req = req.header("x-api-key", key);
    }
    if let Some(b) = body {
        let bytes = B64.decode(b).map_err(|e| e.to_string())?;
        req = req.body(if local { bytes } else { substitute_secrets(bytes)? });
    }

    let ch = on_event.clone();
    let task = tokio::spawn(async move {
        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = ch.send(FetchEvent::Error { message: format!("Network error: {e}") });
                return;
            }
        };
        let status = resp.status().as_u16();
        let headers = resp
            .headers()
            .iter()
            .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_string(), v.to_string())))
            .collect();
        if ch.send(FetchEvent::Head { status, headers }).is_err() {
            return;
        }
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    if ch.send(FetchEvent::Chunk { b64: B64.encode(&bytes) }).is_err() {
                        return;
                    }
                }
                Err(e) => {
                    let _ = ch.send(FetchEvent::Error { message: format!("Stream error: {e}") });
                    return;
                }
            }
        }
        let _ = ch.send(FetchEvent::End);
    });
    state.0.lock().map_err(|e| e.to_string())?.insert(id, task.abort_handle());
    let _ = task.await;
    if let Ok(mut m) = state.0.lock() {
        m.remove(&id);
    }
    Ok(())
}

#[tauri::command]
pub fn api_abort(state: State<'_, Inflight>, id: u32) {
    if let Ok(mut m) = state.0.lock() {
        if let Some(h) = m.remove(&id) {
            h.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn leaves_plain_bodies_alone() {
        let b = br#"{"a":"b"}"#.to_vec();
        assert_eq!(substitute_secrets(b.clone()).unwrap(), b);
    }
    #[test]
    fn local_model_requests() {
        assert!(is_local_model_request("http://localhost:11434/api/tags", "GET"));
        assert!(is_local_model_request("http://127.0.0.1:11434/api/tags", "GET"));
        assert!(is_local_model_request("http://localhost:11434/v1/messages", "POST"));
        // wrong method, path, port, scheme, host, credentials, query
        assert!(!is_local_model_request("http://localhost:11434/api/tags", "POST"));
        assert!(!is_local_model_request("http://localhost:11434/v1/messages", "GET"));
        assert!(!is_local_model_request("http://localhost:11434/api/delete", "POST"));
        assert!(!is_local_model_request("http://localhost:11434/api/tags?x=1", "GET"));
        assert!(!is_local_model_request("http://localhost:3000/api/tags", "GET"));
        assert!(!is_local_model_request("http://localhost/api/tags", "GET"));
        assert!(!is_local_model_request("https://localhost:11434/api/tags", "GET"));
        assert!(!is_local_model_request("http://localhost.evil.com:11434/api/tags", "GET"));
        assert!(!is_local_model_request("http://user:pw@localhost:11434/api/tags", "GET"));
        assert!(!is_local_model_request("http://192.168.1.5:11434/api/tags", "GET"));
        assert!(!is_local_model_request("http://[::1]:11434/api/tags", "GET"));
        assert!(!is_local_model_request("https://api.anthropic.com/v1/messages", "POST"));
    }
    #[test]
    fn rejects_unknown_app_reference() {
        let b = br#"{"t":"aura-secret://nope123"}"#.to_vec();
        assert!(substitute_secrets(b).is_err());
    }
}

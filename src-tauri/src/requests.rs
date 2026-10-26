#![cfg(feature = "automation")]

//! Requests the launcher sends itself.
//!
//! Not `fetch` in the page: this leaves the launcher process with a TLS and
//! HTTP/2 fingerprint chosen on purpose, through the profile's own proxy. An
//! API call made beside a browsing session therefore comes from the same
//! address and looks like the same client, which is the whole reason to send
//! it from here rather than from the page.
//!
//! Two modes, and the difference matters:
//!
//!   * **with a session** — the client is kept under a name, so cookies, the
//!     connection pool and the TLS session tickets carry from one step to the
//!     next. This is what a sequence of calls to one site should use.
//!   * **without** — a client is built for the request and dropped. Nothing
//!     carries over, which is what a one-off call to an unrelated service
//!     wants.

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// Clients held open by name. Never keyed on the URL: a session is the
/// operator's idea of "the same visitor", and only they know which calls
/// belong to one.
fn sessions() -> &'static Mutex<HashMap<String, wreq::Client>> {
    static S: OnceLock<Mutex<HashMap<String, wreq::Client>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Every fingerprint this build can wear, by the name it is chosen with —
/// chrome_140, firefox_133, safari_18, okhttp_5 and the rest. Read off the
/// library itself rather than kept in a list here, which would go stale the
/// first time it is updated.
pub fn fingerprints() -> Vec<String> {
    let mut out: Vec<String> = wreq_util::Profile::VARIANTS
        .iter()
        .filter_map(|p| serde_json::to_value(p).ok())
        .filter_map(|v| v.as_str().map(String::from))
        .collect();
    out.sort();
    out
}

fn parse_fingerprint(name: &str) -> Result<wreq_util::Profile> {
    serde_json::from_value(Value::String(name.trim().to_string()))
        .map_err(|_| anyhow!("unknown TLS fingerprint \"{name}\""))
}

/// What one call needs. Everything optional has a sane absence: no
/// fingerprint means wreq's own default, no session means a throwaway client,
/// no proxy means straight out of this machine.
pub struct Request {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub fingerprint: Option<String>,
    pub session: Option<String>,
    pub proxy: Option<String>,
    pub timeout_s: f64,
}

fn build_client(
    fingerprint: Option<&str>,
    proxy: Option<&str>,
    timeout: Duration,
    keep_cookies: bool,
) -> Result<wreq::Client> {
    let mut b = wreq::Client::builder().timeout(timeout);
    if let Some(name) = fingerprint.filter(|s| !s.trim().is_empty()) {
        b = b.emulation(parse_fingerprint(name)?);
    }
    if let Some(p) = proxy.filter(|s| !s.trim().is_empty()) {
        b = b.proxy(wreq::Proxy::all(p).with_context(|| format!("proxy {p}"))?);
    }
    // Only a session keeps a jar. A throwaway client that stored cookies would
    // still throw them away, and asking for one costs a lock per request.
    b = b.cookie_store(keep_cookies);
    b.build().context("building the request client")
}

/// Sends one request and returns `{ status, headers, body }`.
pub async fn send(req: Request) -> Result<Value> {
    let timeout = Duration::from_secs_f64(req.timeout_s.clamp(1.0, 600.0));
    let session = req.session.as_deref().filter(|s| !s.trim().is_empty());

    let client = match session {
        Some(name) => {
            // Built once and reused. A session that changed its fingerprint or
            // its proxy halfway would be two visitors wearing one name, so the
            // first call's choices are the session's for its whole life — say
            // so rather than silently ignoring the later ones.
            let existing = sessions()
                .lock()
                .map_err(|_| anyhow!("session lock poisoned"))?
                .get(name)
                .cloned();
            match existing {
                Some(c) => c,
                None => {
                    let c = build_client(
                        req.fingerprint.as_deref(),
                        req.proxy.as_deref(),
                        timeout,
                        true,
                    )?;
                    sessions()
                        .lock()
                        .map_err(|_| anyhow!("session lock poisoned"))?
                        .insert(name.to_string(), c.clone());
                    c
                }
            }
        }
        None => build_client(
            req.fingerprint.as_deref(),
            req.proxy.as_deref(),
            timeout,
            false,
        )?,
    };

    let method: wreq::Method = req
        .method
        .trim()
        .to_uppercase()
        .parse()
        .map_err(|_| anyhow!("\"{}\" is not an HTTP method", req.method))?;

    let mut rb = client.request(method, req.url.trim());
    for (k, v) in &req.headers {
        rb = rb.header(k.as_str(), v.as_str());
    }
    if let Some(body) = req.body.filter(|b| !b.is_empty()) {
        rb = rb.body(body);
    }

    let resp = rb.send().await.context("sending the request")?;
    let status = resp.status().as_u16();
    let mut headers = serde_json::Map::new();
    for (k, v) in resp.headers().iter() {
        headers.insert(
            k.as_str().to_string(),
            Value::String(v.to_str().unwrap_or("").to_string()),
        );
    }
    let body = resp.text().await.unwrap_or_default();
    Ok(json!({ "status": status, "headers": headers, "body": body }))
}

/// Forgets a session, cookies and all. A run that ends without this leaves its
/// jar behind for the next one, which is a logged-in visitor arriving out of
/// nowhere.
pub fn drop_session(name: &str) {
    if let Ok(mut g) = sessions().lock() {
        g.remove(name);
    }
}

/// Forgets every session. Called when a run finishes.
pub fn drop_all_sessions() {
    if let Ok(mut g) = sessions().lock() {
        g.clear();
    }
}

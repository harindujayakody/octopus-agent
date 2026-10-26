//! The Web Store's update check (`update2`, gupdate protocol 2.0): building
//! the GETs and reading the answer the way Chrome's safe_manifest_parser does.

use super::chrome_id::is_id;
use super::version::Version;
use quick_xml::events::{BytesStart, Event};
use quick_xml::name::{Namespace, ResolveResult};
use quick_xml::NsReader;

pub const WEBSTORE_UPDATE: &str = "https://clients2.google.com/service/update2/crx";
/// `kExtensionsManifestMaxURLSize`; the first item goes in whatever its length.
pub const URL_BUDGET: usize = 2000;
const GUPDATE_NS: &[u8] = b"http://www.google.com/update2/response";

/// The launcher says what it is; the store answers it as it answers Chrome.
pub fn user_agent() -> String {
    format!("ShardX-Launcher/{}", env!("CARGO_PKG_VERSION"))
}

/// The engine's version. Without it the store answers "noupdate" to everything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProdVersion(String);

impl ProdVersion {
    pub fn new(v: &str) -> Option<ProdVersion> {
        Version::parse(v).map(|_| ProdVersion(v.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// One or more update-check URLs for `(id, installed version)` pairs, each
/// within the budget. Pairs with a malformed id or version are left out.
pub fn requests(base: &str, prod: &ProdVersion, items: &[(String, String)]) -> Vec<String> {
    batches(base, prod, items).into_iter().map(|(url, _)| url).collect()
}

/// As `requests`, each URL with the pairs it asks about.
pub fn batches(base: &str, prod: &ProdVersion, items: &[(String, String)]) -> Vec<(String, Vec<(String, String)>)> {
    let head = format!("{base}?response=updatecheck&acceptformat=crx3&prodversion={}", prod.0);
    let mut out = Vec::new();
    let (mut url, mut asked) = (head.clone(), Vec::new());
    for (id, v) in items {
        if !is_id(id) || Version::parse(v).is_none() {
            continue;
        }
        let x: String = url::form_urlencoded::byte_serialize(format!("id={id}&v={v}&uc").as_bytes()).collect();
        let extra = format!("&x={x}");
        if url.len() > head.len() && url.len() + extra.len() > URL_BUDGET {
            out.push((std::mem::replace(&mut url, head.clone()), std::mem::take(&mut asked)));
        }
        url.push_str(&extra);
        asked.push((id.clone(), v.clone()));
    }
    if url.len() > head.len() {
        out.push((url, asked));
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Answer {
    Update { version: String, codebase: String, sha256: Option<String>, size: Option<u64> },
    NoUpdate,
    /// The app's status is not "ok" (an id the store never had).
    Unknown(String),
    /// No answer that can be acted on: no or several updatecheck, a bad codebase or version, not XML.
    Error(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Flag {
    Malware,
    PolicyViolation,
    PotentiallyUws,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppAnswer {
    pub id: String,
    pub answer: Answer,
    pub flags: Vec<Flag>,
    /// `_esbAllowlist`: whether the store vouches for the publisher.
    pub allowlisted: Option<bool>,
}

/// What the store said about each asked item, in the order asked: an update
/// no newer than the installed version is NoUpdate, an item it skipped or a
/// body that is not its XML is `Error("no answer")`.
pub fn answers(body: &[u8], asked: &[(String, String)]) -> Vec<AppAnswer> {
    let parsed = parse(body).unwrap_or_default();
    asked
        .iter()
        .map(|(id, installed)| {
            let Some(mut a) = parsed.iter().find(|a| &a.id == id).cloned() else {
                return AppAnswer { id: id.clone(), answer: Answer::Error("no answer".into()), flags: vec![], allowlisted: None };
            };
            if let Answer::Update { version, .. } = &a.answer {
                if !super::version::newer(version, installed) {
                    a.answer = Answer::NoUpdate;
                }
            }
            a
        })
        .collect()
}

/// Every `<app>` of a gupdate response; Err when the body is not one.
pub fn parse(body: &[u8]) -> Result<Vec<AppAnswer>, String> {
    let text = std::str::from_utf8(body).map_err(|_| "no answer".to_string())?;
    let mut r = NsReader::from_str(text);
    let (mut depth, mut root) = (0usize, false);
    let mut apps = Vec::new();
    // The <app> being read: its id and status, and the updatechecks inside it.
    let mut app: Option<(String, String, Vec<Attrs>)> = None;
    loop {
        let (ns, ev) = r.read_resolved_event().map_err(|e| format!("not XML: {e}"))?;
        let in_ns = matches!(ns, ResolveResult::Bound(Namespace(n)) if n == GUPDATE_NS);
        match ev {
            Event::Start(ref e) | Event::Empty(ref e) => {
                let empty = matches!(ev, Event::Empty(_));
                let name = e.local_name().as_ref().to_vec();
                match depth {
                    0 => {
                        if !in_ns || name != b"gupdate" || attr(&r, e, "protocol").as_deref() != Some("2.0") {
                            return Err("not a gupdate response".into());
                        }
                        root = true;
                    }
                    1 if in_ns && name == b"app" => {
                        let id = attr(&r, e, "appid").unwrap_or_default();
                        let status = attr(&r, e, "status").unwrap_or_default();
                        app = Some((id, status, vec![]));
                    }
                    2 if in_ns && name == b"updatecheck" => {
                        if let Some((_, _, checks)) = app.as_mut() {
                            checks.push(attrs(&r, e));
                        }
                    }
                    _ => {}
                }
                if empty {
                    if depth == 1 {
                        apps.extend(app.take().map(finish));
                    }
                } else {
                    depth += 1;
                }
            }
            Event::End(_) => {
                depth = depth.saturating_sub(1);
                if depth == 1 {
                    apps.extend(app.take().map(finish));
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !root || depth != 0 {
        return Err("no answer".into());
    }
    Ok(apps.into_iter().filter(|a| !a.id.is_empty()).collect())
}

type Attrs = Vec<(String, String)>;

fn attrs(r: &NsReader<&[u8]>, e: &BytesStart) -> Attrs {
    e.attributes()
        .flatten()
        .filter_map(|a| {
            let k = String::from_utf8(a.key.local_name().as_ref().to_vec()).ok()?;
            let v = a.decode_and_unescape_value(r.decoder()).ok()?.into_owned();
            Some((k, v))
        })
        .collect()
}

fn attr(r: &NsReader<&[u8]>, e: &BytesStart, key: &str) -> Option<String> {
    attrs(r, e).into_iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

fn finish((id, status, checks): (String, String, Vec<Attrs>)) -> AppAnswer {
    let mut out = AppAnswer { id, answer: Answer::NoUpdate, flags: vec![], allowlisted: None };
    if !status.is_empty() && status != "ok" {
        out.answer = Answer::Unknown(status);
        return out;
    }
    let [uc] = checks.as_slice() else {
        let what = if checks.is_empty() { "no updatecheck" } else { "several updatecheck" };
        out.answer = Answer::Error(what.into());
        return out;
    };
    let at = |k: &str| get(uc, k);
    for (key, flag) in [("_malware", Flag::Malware), ("_policy_violation", Flag::PolicyViolation), ("_potentially_uws", Flag::PotentiallyUws)] {
        if at(key) == Some("true") {
            out.flags.push(flag);
        }
    }
    out.allowlisted = match at("_esbAllowlist") {
        Some("true") => Some(true),
        Some("false") => Some(false),
        _ => None,
    };
    out.answer = match at("status").unwrap_or("") {
        "noupdate" => Answer::NoUpdate,
        "ok" | "" => update(uc),
        other => Answer::Error(format!("updatecheck status {other}")),
    };
    out
}

fn get<'a>(uc: &'a Attrs, key: &str) -> Option<&'a str> {
    uc.iter().find(|(n, _)| n == key).map(|(_, v)| v.as_str())
}

fn update(uc: &Attrs) -> Answer {
    let at = |k: &str| get(uc, k);
    let codebase = at("codebase").unwrap_or("");
    match url::Url::parse(codebase) {
        Ok(u) if u.scheme() == "https" => {}
        Ok(_) => return Answer::Error("codebase is not https".into()),
        Err(_) => return Answer::Error("bad codebase".into()),
    }
    let version = at("version").unwrap_or("");
    if Version::parse(version).is_none() {
        return Answer::Error(format!("bad version {version:?}"));
    }
    let sha256 = match at("hash_sha256") {
        None | Some("") => None,
        Some(h) if h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()) => Some(h.to_ascii_lowercase()),
        Some(_) => return Answer::Error("bad hash_sha256".into()),
    };
    let size = at("size").and_then(|s| s.parse().ok());
    Answer::Update { version: version.into(), codebase: codebase.into(), sha256, size }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(format!("{}/tests/fixtures/ext/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
    }

    const METAMASK: &str = "nkbihfbeogaeaoehlefnkodbefgpgknn";
    const RABBY: &str = "acmacodkjbdgmoleebolmdjonilkdbch";
    const PHANTOM: &str = "bfnaelmomeimhlpmgjnjophhpkkoljpa";
    const KEPLR: &str = "dmkamcknogkgcdfhhbddcghachkejeap";

    fn prod() -> ProdVersion {
        ProdVersion::new("156.0.8078.48").unwrap()
    }

    fn pair(id: &str, v: &str) -> (String, String) {
        (id.to_string(), v.to_string())
    }

    fn id_of(n: usize) -> String {
        super::super::chrome_id::id_from_key(n.to_string().as_bytes())
    }

    #[test]
    fn request_shape() {
        let urls = requests(WEBSTORE_UPDATE, &prod(), &[pair(METAMASK, "13.46.1.0"), pair(RABBY, "0.94.6")]);
        assert_eq!(
            urls,
            [format!(
                "{WEBSTORE_UPDATE}?response=updatecheck&acceptformat=crx3&prodversion=156.0.8078.48\
                 &x=id%3D{METAMASK}%26v%3D13.46.1.0%26uc&x=id%3D{RABBY}%26v%3D0.94.6%26uc"
            )]
        );
        assert!(!urls[0].contains("puff") && !urls[0].contains("os=") && !urls[0].contains("arch="));
        assert_eq!(user_agent(), format!("ShardX-Launcher/{}", env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn nothing_linked_nothing_asked() {
        assert!(requests(WEBSTORE_UPDATE, &prod(), &[]).is_empty());
        assert!(requests(WEBSTORE_UPDATE, &prod(), &[pair("nope", "1.0"), pair(METAMASK, "01.0")]).is_empty());
    }

    #[test]
    fn prodversion_is_never_empty() {
        assert!(ProdVersion::new("").is_none());
        assert!(ProdVersion::new("abc").is_none());
        assert_eq!(prod().as_str(), "156.0.8078.48");
    }

    #[test]
    fn split_at_the_budget() {
        let items: Vec<_> = (0..200).map(|n| pair(&id_of(n), "1.2.3.4")).collect();
        let urls = requests(WEBSTORE_UPDATE, &prod(), &items);
        assert!(urls.len() > 1);
        assert!(urls.iter().all(|u| u.len() <= URL_BUDGET), "every GET within 2000");
        let total: usize = urls.iter().map(|u| u.matches("&x=").count()).sum();
        assert_eq!(total, 200, "nothing dropped");
        // Each batch names exactly the pairs its URL asks about.
        let b = batches(WEBSTORE_UPDATE, &prod(), &items);
        assert_eq!(b.iter().map(|(u, _)| u.clone()).collect::<Vec<_>>(), urls);
        assert!(b.iter().all(|(u, asked)| u.matches("&x=").count() == asked.len()));
        assert_eq!(b.iter().flat_map(|(_, a)| a.clone()).collect::<Vec<_>>(), items);
        for u in &urls {
            assert!(u.starts_with(&format!("{WEBSTORE_UPDATE}?response=updatecheck&acceptformat=crx3&prodversion=156.0.8078.48&x=")));
        }
        // A base long enough that one item overflows still sends it, alone.
        let long = format!("https://example.test/{}", "a".repeat(2100));
        let urls = requests(&long, &prod(), &items[..2]);
        assert_eq!(urls.len(), 2);
        assert!(urls.iter().all(|u| u.matches("&x=").count() == 1));
    }

    #[test]
    fn live_answer_four_updates_and_an_unknown() {
        let apps = parse(&fixture("resp1.xml")).unwrap();
        assert_eq!(apps.len(), 5);
        let mm = &apps[0];
        assert_eq!(mm.id, METAMASK);
        assert_eq!(mm.allowlisted, Some(true));
        assert!(mm.flags.is_empty());
        let Answer::Update { version, codebase, sha256, size } = &mm.answer else { panic!("{mm:?}") };
        assert_eq!(version, "13.53.0.0");
        assert!(codebase.starts_with("https://clients2.googleusercontent.com/crx/blobs/"));
        assert!(codebase.ends_with("/NKBIHFBEOGAEAOEHLEFNKODBEFGPGKNN_13_53_0_0.crx"));
        assert_eq!(sha256.as_deref(), Some("de0dc9366f76486ee2168342727e265ec1023d2a32108050578429e0096fcb12"));
        assert_eq!(*size, Some(25224198));
        let versions: Vec<_> = apps[1..4]
            .iter()
            .map(|a| match &a.answer {
                Answer::Update { version, .. } => (a.id.as_str(), version.as_str()),
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(versions, [(RABBY, "0.94.13"), (PHANTOM, "26.34.0"), (KEPLR, "0.13.53")]);
        assert_eq!(apps[4].id, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert_eq!(apps[4].answer, Answer::Unknown("error-unknownApplication".into()));
    }

    #[test]
    fn live_answers_noupdate() {
        let apps = parse(&fixture("resp2.xml")).unwrap();
        assert_eq!(apps.len(), 2);
        assert!(apps.iter().all(|a| a.answer == Answer::NoUpdate && a.allowlisted == Some(true)));
        let rabby = parse(&fixture("crit_rabby_noprod.xml")).unwrap();
        assert_eq!(rabby[0].answer, Answer::NoUpdate);
        assert_eq!(rabby[0].allowlisted, None);
    }

    #[test]
    fn removed_extensions_flags_and_allowlist() {
        let apps = parse(&fixture("crit_removed.xml")).unwrap();
        assert_eq!(apps.len(), 3);
        // The Great Suspender: taken down for malware.
        assert_eq!(apps[0].answer, Answer::NoUpdate);
        assert_eq!(apps[0].flags, [Flag::Malware]);
        assert_eq!(apps[0].allowlisted, Some(false));
        // uBlock Origin MV2: gone from the store, not flagged.
        assert_eq!(apps[1].answer, Answer::NoUpdate);
        assert!(apps[1].flags.is_empty());
        assert_eq!(apps[1].allowlisted, Some(false));
        assert_eq!(apps[2].allowlisted, Some(true));
        assert!(matches!(apps[2].answer, Answer::Update { .. }));
    }

    #[test]
    fn answers_follow_what_was_asked() {
        let body = fixture("resp1.xml");
        let asked = [pair(METAMASK, "13.53.0"), pair(RABBY, "0.94.6"), pair("pppppppppppppppppppppppppppppppp", "1.0")];
        let got = answers(&body, &asked);
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].answer, Answer::NoUpdate, "13.53.0.0 is not newer than 13.53.0");
        assert_eq!(got[0].allowlisted, Some(true), "the rest of the answer is kept");
        assert!(matches!(&got[1].answer, Answer::Update { version, .. } if version == "0.94.13"));
        assert_eq!(got[2].answer, Answer::Error("no answer".into()));
        for junk in [&b""[..], b"<html><body>Sign in to Wi-Fi</body></html>", b"\xff\xfe", b"<gupdate", b"{\"apps\":[]}"] {
            let got = answers(junk, &asked);
            assert!(got.iter().all(|a| a.answer == Answer::Error("no answer".into())), "{junk:?}");
        }
    }

    fn one(updatecheck: &str) -> AppAnswer {
        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0"><app appid="{METAMASK}" status="ok">{updatecheck}</app></gupdate>"#
        );
        let mut apps = parse(xml.as_bytes()).unwrap();
        assert_eq!(apps.len(), 1);
        apps.remove(0)
    }

    const GOOD: &str = r#"codebase="https://example.test/a.crx" version="2.0""#;

    #[test]
    fn synthetic_answers() {
        let a = one(&format!(r#"<updatecheck status="ok" {GOOD} _malware="true" _policy_violation="true" _potentially_uws="false"/>"#));
        assert_eq!(a.flags, [Flag::Malware, Flag::PolicyViolation]);
        assert!(matches!(a.answer, Answer::Update { ref sha256, size: None, .. } if sha256.is_none()));
        assert_eq!(one("").answer, Answer::Error("no updatecheck".into()));
        assert_eq!(
            one(&format!(r#"<updatecheck status="ok" {GOOD}/><updatecheck status="noupdate"/>"#)).answer,
            Answer::Error("several updatecheck".into())
        );
        assert_eq!(
            one(r#"<updatecheck status="ok" codebase="http://example.test/a.crx" version="2.0"/>"#).answer,
            Answer::Error("codebase is not https".into())
        );
        assert_eq!(one(r#"<updatecheck status="ok" version="2.0"/>"#).answer, Answer::Error("bad codebase".into()));
        assert!(matches!(
            one(r#"<updatecheck status="ok" codebase="https://example.test/a.crx" version="01.2"/>"#).answer,
            Answer::Error(_)
        ));
        assert!(matches!(one(&format!(r#"<updatecheck status="ok" {GOOD} hash_sha256="zz"/>"#)).answer, Answer::Error(_)));
        assert_eq!(one(r#"<updatecheck status="error-internal"/>"#).answer, Answer::Error("updatecheck status error-internal".into()));
        // An updatecheck nested deeper than the app is not the app's.
        assert_eq!(one(&format!(r#"<data><updatecheck status="ok" {GOOD}/></data>"#)).answer, Answer::Error("no updatecheck".into()));
        // Entities in the codebase are read as XML reads them.
        let a = one(r#"<updatecheck status="ok" codebase="https://example.test/a.crx?x=1&amp;y=2" version="2.0"/>"#);
        assert!(matches!(a.answer, Answer::Update { ref codebase, .. } if codebase == "https://example.test/a.crx?x=1&y=2"));
    }

    #[test]
    fn wrong_document_is_no_answer() {
        for bad in [
            r#"<gupdate protocol="2.0"><app appid="x" status="ok"/></gupdate>"#,
            r#"<gupdate xmlns="http://www.google.com/update2/response" protocol="3.0"></gupdate>"#,
            r#"<other xmlns="http://www.google.com/update2/response" protocol="2.0"></other>"#,
            r#"<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0"><app appid="x">"#,
        ] {
            assert!(parse(bad.as_bytes()).is_err(), "{bad}");
        }
        let empty = r#"<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0"/>"#;
        assert_eq!(parse(empty.as_bytes()).unwrap(), vec![]);
    }
}

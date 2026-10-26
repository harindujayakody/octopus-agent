//! A pasted Web Store link, read as strictly as the front's `isStoreLink`
//! (SEC-08): the URL is parsed, never matched as a string.

use super::chrome_id::is_id;

/// The extension id a Web Store page or a bare id names; None for anything else.
pub fn store_id(raw: &str) -> Option<String> {
    // Rust's trim drops every Unicode space, as the front's normalizeExtensionLink does.
    let link = raw.trim();
    if is_id(link) {
        return Some(link.to_string());
    }
    let u = url::Url::parse(link).ok()?;
    if u.scheme() != "https" {
        return None;
    }
    let path = u.path();
    match u.host_str()? {
        "chromewebstore.google.com" => detail_id(path),
        "chrome.google.com" if path.starts_with("/webstore/") => detail_id(path),
        _ => None,
    }
}

/// The id in `/detail/[slug/]<id>`, as the front's DETAIL_PATH finds it:
/// the first `/detail/` that fits, with a slug tried before none.
fn detail_id(path: &str) -> Option<String> {
    // An id, then the end of the path or a slash.
    fn ends_id(s: &str) -> Option<&str> {
        s.get(..32).filter(|id| is_id(id) && matches!(s.as_bytes().get(32), None | Some(b'/')))
    }
    let mut from = 0;
    while let Some(at) = path[from..].find("/detail/") {
        let rest = &path[from + at + "/detail/".len()..];
        if let Some(slash) = rest.find('/').filter(|&n| n > 0) {
            if let Some(id) = ends_id(&rest[slash + 1..]) {
                return Some(id.to_string());
            }
        }
        if let Some(id) = ends_id(rest) {
            return Some(id.to_string());
        }
        from += at + 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::store_id;

    const ID: &str = "nkbihfbeogaeaoehlefnkodbefgpgknn";

    #[test]
    fn store_pages_and_bare_ids() {
        for ok in [
            ID.to_string(),
            format!("  {ID}\u{a0}"),
            format!("\u{85}{ID}"),
            format!("https://chromewebstore.google.com/detail/metamask/{ID}"),
            format!("https://chromewebstore.google.com/detail/metamask/{ID}?hl=en"),
            format!("https://chromewebstore.google.com/detail/metamask/{ID}#reviews"),
            format!("https://chromewebstore.google.com/detail/{ID}"),
            format!("https://chromewebstore.google.com/detail/metamask/{ID}/reviews"),
            format!("https://CHROMEWEBSTORE.google.com/detail/metamask/{ID}"),
            format!("https://chrome.google.com/webstore/detail/metamask/{ID}"),
            format!("https://chromewebstore.google.com/x/../detail/metamask/{ID}"),
        ] {
            assert_eq!(store_id(&ok).as_deref(), Some(ID), "{ok:?}");
        }
    }

    // SEC-08: look-alike hosts, userinfo, other schemes, paths that resolve elsewhere.
    #[test]
    fn look_alikes_are_refused() {
        for bad in [
            format!("https://chromewebstore.google.com.evil.com/detail/metamask/{ID}"),
            format!("https://chromewebstore.google.com@evil.com/detail/metamask/{ID}"),
            format!("https://evil.com/chromewebstore.google.com/detail/metamask/{ID}"),
            format!("https://evil.com/?u=https://chromewebstore.google.com/detail/metamask/{ID}"),
            format!("http://chromewebstore.google.com/detail/metamask/{ID}"),
            format!("javascript://chromewebstore.google.com/detail/metamask/{ID}"),
            format!("https://chrome.google.com/detail/metamask/{ID}"),
            format!("https://chrome.google.com/webstore/../detail/metamask/{ID}"),
            format!("https://chromewebstore.google.com/detail/metamask/{ID}x"),
            format!("https://chromewebstore.google.com/detail/metamask/{}", ID.to_uppercase()),
            format!("https://chromewebstore.google.com/detail/a/b/{ID}"),
            format!("https://chromewebstore.google.com/metamask/{ID}"),
            format!("chromewebstore.google.com/detail/metamask/{ID}"),
            ID.to_uppercase(),
            format!("{ID}q"),
            String::new(),
        ] {
            assert_eq!(store_id(&bad), None, "{bad:?}");
        }
    }

    // The slug is tried first, as the front's regex does.
    #[test]
    fn slug_before_id() {
        let other = "acmacodkjbdgmoleebolmdjonilkdbch";
        let u = format!("https://chromewebstore.google.com/detail/{other}/{ID}");
        assert_eq!(store_id(&u).as_deref(), Some(ID));
    }
}

//! Extension versions, read and ordered as Chrome does
//! (`base/version.cc`, `Extension::LoadVersion`).

use std::cmp::Ordering;
use std::fmt;

/// One to four dot-separated u32 parts; missing parts count as zeros.
#[derive(Debug, Clone)]
pub struct Version(Vec<u32>);

impl Version {
    /// None for what Chrome refuses: a leading zero is only banned in the first part.
    pub fn parse(s: &str) -> Option<Version> {
        let mut parts = Vec::new();
        for (i, p) in s.split('.').enumerate() {
            if p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let n: u32 = p.parse().ok()?;
            if i == 0 && n.to_string() != p {
                return None;
            }
            parts.push(n);
        }
        (1..=4).contains(&parts.len()).then_some(Version(parts))
    }

    pub fn parts(&self) -> &[u32] {
        &self.0
    }
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        let n = self.0.len().max(other.0.len());
        let at = |v: &[u32], i: usize| v.get(i).copied().unwrap_or(0);
        (0..n)
            .map(|i| at(&self.0, i).cmp(&at(&other.0, i)))
            .find(|o| o.is_ne())
            .unwrap_or(Ordering::Equal)
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

// `1.0` and `1.0.0.0` are the same version.
impl PartialEq for Version {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other).is_eq()
    }
}

impl Eq for Version {}

impl fmt::Display for Version {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s: Vec<String> = self.0.iter().map(u32::to_string).collect();
        f.write_str(&s.join("."))
    }
}

/// Whether `candidate` is strictly newer than `installed`; false if either is invalid.
pub fn newer(candidate: &str, installed: &str) -> bool {
    match (Version::parse(candidate), Version::parse(installed)) {
        (Some(c), Some(i)) => c > i,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Version {
        Version::parse(s).unwrap_or_else(|| panic!("{s} should be valid"))
    }

    #[test]
    fn missing_parts_are_zeros() {
        assert_eq!(v("1.0"), v("1.0.0.0"));
        assert_eq!(v("1"), v("1.0.0"));
        assert!(v("1.0.0.1") > v("1"));
    }

    #[test]
    fn parts_compare_as_numbers() {
        assert!(v("13.53.0.0") > v("13.46.1.0"));
        assert!(v("0.94.13") > v("0.94.6"));
        assert!(v("0.13.53") > v("0.13.45"));
        assert!(v("26.34.0") > v("26.28.1"));
        assert!(v("2.10") > v("2.9"));
        assert!(newer("13.53.0.0", "13.46.1.0"));
        assert!(!newer("13.53.0.0", "13.53.0"));
        assert!(!newer("1.0", "junk"));
    }

    #[test]
    fn what_chrome_refuses() {
        for bad in ["", "01.2", "+1", "1.+2", "1..2", "1.2.3.4.5", "1.2.", ".1", "1.-2", "1.a", " 1", "1 ", "4294967296", "00"] {
            assert!(Version::parse(bad).is_none(), "{bad:?} must be invalid");
        }
    }

    #[test]
    fn what_chrome_takes() {
        assert_eq!(v("1.0.02.5"), v("1.0.2.5"));
        assert_eq!(v("1.0.02.5").to_string(), "1.0.2.5");
        assert_eq!(v("0.1").parts(), &[0, 1]);
        assert_eq!(v("4294967295").parts(), &[u32::MAX]);
        assert_eq!(v("156.0.8078.48").parts(), &[156, 0, 8078, 48]);
    }
}

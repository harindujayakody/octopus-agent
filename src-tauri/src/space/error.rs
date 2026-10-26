//! Why a door said no. The local API turns it into a status and a code; the
//! interface reads its words.

use super::client::{Code, TeamError};

/// A right a refusal names, as the team's rules call it, and what it is held on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Need {
    /// see, start, edit, create, delete, cookies, take_out or admin.
    pub right: &'static str,
    /// profile, folder, team or proxy.
    pub on: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CmdError {
    /// Not in the space in use, or hidden from this member.
    Missing(String),
    /// The team's rules do not give it.
    Forbidden(Need),
    /// Not done in a team space.
    NotOffered(&'static str),
    /// Changed since it was read.
    Stale { what: &'static str, now: Option<u64>, had: Option<u64> },
    /// Open on another device, by its name.
    Leased(String),
    /// The launcher moved to another space before this was written.
    SpaceChanged,
    /// The team server did not answer, or no current permission is held.
    Offline(String),
    /// The team server said no for another reason.
    Refused { status: u16, code: String, message: String },
}

/// What a write refused for a switch of space says.
pub const SPACE_CHANGED: &str = "the launcher switched spaces before this was saved: nothing was written";

impl std::fmt::Display for CmdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CmdError::Missing(m) => f.write_str(m),
            CmdError::Forbidden(n) => {
                write!(f, "not allowed in this team: needs {} on the {}", n.right.replace('_', " "), n.on)
            }
            CmdError::NotOffered(m) => f.write_str(m),
            // Worded so the editor's conflict check (`changed after you opened it`) knows it.
            CmdError::Stale { what, now, had } => {
                write!(f, "This {what} changed after you opened it")?;
                match (now, had) {
                    (Some(now), Some(had)) => write!(f, " (rev {now}, you have {had})")?,
                    (Some(now), None) => write!(f, " (rev {now})")?,
                    _ => {}
                }
                f.write_str(" — someone else saved it. Reopen it and apply your changes to the current version.")
            }
            CmdError::Leased(device) => write!(f, "this profile is open on {device}: close it there first"),
            CmdError::SpaceChanged => f.write_str(SPACE_CHANGED),
            CmdError::Offline(why) => write!(f, "the team server did not answer: {why}"),
            CmdError::Refused { message, .. } => f.write_str(message),
        }
    }
}

impl std::error::Error for CmdError {}

/// What a team call was doing, to read the server's refusal by.
pub struct Doing<'a> {
    pub need: Need,
    /// profile, proxy or folder.
    pub what: &'static str,
    pub id: &'a str,
    /// The revision the write was made from.
    pub had: Option<u64>,
}

impl CmdError {
    /// The server's refusal in the launcher's terms.
    pub fn from_team(e: TeamError, doing: &Doing<'_>) -> CmdError {
        let r = match e {
            TeamError::Offline(why) => return CmdError::Offline(why),
            TeamError::Garbled(why) => {
                return CmdError::Refused { status: 502, code: "garbled".into(), message: why };
            }
            TeamError::Refused(r) => r,
        };
        match &r.code {
            Code::Stale => CmdError::Stale {
                what: doing.what,
                now: r.current_revision.or(r.current_session_rev).or(r.current_package_rev),
                had: doing.had,
            },
            Code::Leased => CmdError::Leased(
                r.lease
                    .as_ref()
                    .map(|l| l.device_name.clone())
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| "another device".into()),
            ),
            Code::Forbidden => CmdError::Forbidden(doing.need),
            Code::NotFound => CmdError::Missing(format!("no {} {} in this team", doing.what, doing.id)),
            code => CmdError::Refused {
                status: r.status,
                code: code.as_str().to_string(),
                message: TeamError::Refused(r.clone()).to_string(),
            },
        }
    }

    /// The local API's status for it.
    pub fn status(&self) -> u16 {
        match self {
            CmdError::Missing(_) => 404,
            CmdError::Forbidden(_) | CmdError::NotOffered(_) => 403,
            CmdError::Stale { .. } | CmdError::Leased(_) | CmdError::SpaceChanged => 409,
            CmdError::Offline(_) => 503,
            // The local caller's own token is good: a lost team token is a refusal here.
            CmdError::Refused { status: 401, .. } => 403,
            CmdError::Refused { status, .. } if (400..600).contains(status) => *status,
            CmdError::Refused { .. } => 502,
        }
    }

    /// The local API's code for it.
    pub fn code(&self) -> &str {
        match self {
            CmdError::Missing(_) => "not_found",
            CmdError::Forbidden(_) => "forbidden",
            CmdError::NotOffered(_) => "not_offered",
            CmdError::Stale { .. } => "stale",
            CmdError::Leased(_) => "leased",
            CmdError::SpaceChanged => "space_changed",
            CmdError::Offline(_) => "offline",
            CmdError::Refused { code, .. } => code,
        }
    }
}

/// The door's own refusal inside an error, if it is one.
pub fn find(e: &anyhow::Error) -> Option<&CmdError> {
    e.chain().find_map(|c| c.downcast_ref::<CmdError>())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stale_save_reads_as_the_editors_conflict() {
        let e = CmdError::Stale { what: "profile", now: Some(3), had: Some(2) };
        assert!(e.to_string().contains("changed after you opened it (rev 3, you have 2)"), "{e}");
        assert_eq!((e.status(), e.code()), (409, "stale"));
        let need = Need { right: "take_out", on: "team" };
        assert_eq!(CmdError::Forbidden(need).to_string(), "not allowed in this team: needs take out on the team");
        let wrapped = anyhow::Error::new(CmdError::SpaceChanged).context("saving");
        assert_eq!(find(&wrapped), Some(&CmdError::SpaceChanged));
        assert_eq!(CmdError::Refused { status: 401, code: "unauthorized".into(), message: String::new() }.status(), 403);
    }
}

//! What of the team a member can see, as the lists show it. A permission
//! carries only the rules about that, so a refusal never names what is hidden.

use std::cmp::Ordering;

use crate::model::{decide, Action, Decision, Grant, Scope, Target};

/// A proxy is in no folder: only the team and a rule naming this one proxy decide.
pub fn proxy_target(id: &str) -> Target<'_> {
    Target { profile_id: Some(id), folder: None }
}

pub fn may_see(grants: &[Grant], target: &Target<'_>) -> bool {
    decide(grants, Action::See, target).is_allowed()
}

/// A team folder is the member's to know about when a rule lets them See it,
/// or they may See a profile in it. `ids` are the profiles in it.
pub fn sees_folder<'a>(grants: &[Grant], name: &str, ids: impl IntoIterator<Item = &'a str>) -> bool {
    may_see(grants, &Target::folder(name))
        || ids.into_iter().any(|id| may_see(grants, &Target::profile(id, name)))
}

/// A folder name a permission may carry rules about, there yet or not: one
/// they may See, or one their own rule on it lets them make profiles in.
pub fn names_folder(grants: &[Grant], name: &str) -> bool {
    let t = Target::folder(name);
    may_see(grants, &t)
        || matches!(decide(grants, Action::Create, &t), Decision::Allowed { by: Scope::Folder { .. } })
}

/// One fixed order for rules, so two tables compare as sets.
pub fn sort_rules(rules: &mut [Grant]) {
    rules.sort_by(rule_order);
}

fn rule_order(a: &Grant, b: &Grant) -> Ordering {
    rule_key(a).cmp(&rule_key(b))
}

fn rule_key(g: &Grant) -> (u8, &str, Option<usize>, bool) {
    let (kind, name) = match &g.scope {
        Scope::Team => (0, ""),
        Scope::Folder { name } => (1, name.as_str()),
        Scope::Profile { id } => (2, id.as_str()),
    };
    (kind, name, Action::ALL.iter().position(|a| *a == g.action), g.allow)
}

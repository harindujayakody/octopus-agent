//! The live channel: how a change to someone's rights reaches their launcher
//! in seconds instead of at the next expiry.
//!
//! A permission is good for fifteen minutes, which is what lets a member keep
//! working through a dropped connection. That same fifteen minutes would be
//! how long a withdrawn right kept working, which is too long for the thing
//! the admin pressed the button for. So the server also keeps a socket open to
//! every connected member and, the moment their table changes, tells them.
//!
//! The launcher's part of the bargain: on `grants-changed` it fetches a new
//! permission at once and applies it to what is already open — a profile whose
//! right has just gone is closed, not left running until its window is shut.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::{broadcast, Notify, RwLock};

/// The most live sockets one member keeps open; a new one past it closes their oldest.
pub const MAX_SOCKETS: usize = 8;

/// What the server says down the socket. One shape, so a launcher that meets a
/// kind it does not know can ignore it and still handle the rest.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Event {
    /// This member's rights were rewritten. `epoch` is the edition they should
    /// now be holding; anything older is stale.
    GrantsChanged { epoch: u64 },
    /// The member was switched off. Nothing of theirs should stay open, and no
    /// new permission will be issued.
    Revoked,
    /// The admin re-issued this member's token: the one in use stops working now.
    /// Not a removal: they stay in the team under the new invite. Said, then closed.
    TokenReplaced,
    /// Something in the team's own data changed, told only to the members who
    /// may see that item. Carries no secrets: the launcher refetches.
    /// `what`: profile, proxy, folder, trash, lease (opened, closed or ran out), team
    /// (renamed), session (uploaded), an item kind (bookmark, extension,
    /// automation, tag) or package (an extension's).
    TeamChanged { what: &'static str, id: String },
    /// Something in this member's own space changed. Sent to them alone.
    /// `what`: profile, proxy, folder, lease (as in the team), session, an item kind, package.
    PersonalChanged { what: &'static str, id: String },
}

/// Each member's open sockets, oldest first, each with the switch that closes it.
type Seats = HashMap<String, VecDeque<(u64, Arc<Notify>)>>;

/// Everyone currently listening, by member id. A member may have more than one
/// launcher open, so each gets its own sender.
#[derive(Clone, Default)]
pub struct Hub {
    inner: Arc<RwLock<HashMap<String, broadcast::Sender<Event>>>>,
    seats: Arc<Mutex<Seats>>,
    next_seat: Arc<AtomicU64>,
}

/// One open socket's place among its member's. Dropping it gives the place up;
/// `closed` fires when a newer socket of theirs took it.
pub struct Seat {
    hub: Hub,
    member_id: String,
    id: u64,
    pub closed: Arc<Notify>,
}

impl std::fmt::Debug for Seat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Seat").field("member_id", &self.member_id).field("id", &self.id).finish()
    }
}

impl Drop for Seat {
    fn drop(&mut self) {
        let mut seats = self.hub.seats.lock().unwrap();
        if let Some(line) = seats.get_mut(&self.member_id) {
            line.retain(|(id, _)| *id != self.id);
            if line.is_empty() {
                seats.remove(&self.member_id);
            }
        }
    }
}

impl Hub {
    pub fn new() -> Self {
        Hub::default()
    }

    /// Listen as `member_id`. Dropping the receiver leaves the sender in place
    /// for the member's other windows; an entry with no listeners is cleaned
    /// up the next time we try to send to it.
    pub async fn subscribe(&self, member_id: &str) -> broadcast::Receiver<Event> {
        let mut g = self.inner.write().await;
        let tx = g
            .entry(member_id.to_string())
            .or_insert_with(|| broadcast::channel(32).0);
        tx.subscribe()
    }

    /// A place for one more socket of `member_id`'s; past `max` their oldest is
    /// told to close, so a launcher that silently lost its socket still gets in.
    pub fn seat(&self, member_id: &str, max: usize) -> Seat {
        let id = self.next_seat.fetch_add(1, Ordering::Relaxed);
        let closed = Arc::new(Notify::new());
        let mut seats = self.seats.lock().unwrap();
        let line = seats.entry(member_id.to_string()).or_default();
        line.push_back((id, closed.clone()));
        while line.len() > max {
            if let Some((_, oldest)) = line.pop_front() {
                oldest.notify_one();
            }
        }
        Seat { hub: self.clone(), member_id: member_id.into(), id, closed }
    }

    /// Tell one member. Silent when they are not connected: the permission they
    /// hold still expires on its own, which is the fallback this rides on.
    pub async fn send_to(&self, member_id: &str, event: Event) {
        let drop_it = {
            let g = self.inner.read().await;
            match g.get(member_id) {
                None => false,
                Some(tx) => tx.send(event).is_err(),
            }
        };
        if drop_it {
            // Nobody is listening any more; forget the entry rather than
            // keeping a channel per member who ever connected.
            self.inner.write().await.remove(member_id);
        }
    }

    /// Who is listening now. A change to the team goes to each of them who
    /// may see the item, never to all at once: that would tell everyone it exists.
    pub async fn listeners(&self) -> Vec<String> {
        self.inner
            .read()
            .await
            .iter()
            .filter(|(_, tx)| tx.receiver_count() > 0)
            .map(|(id, _)| id.clone())
            .collect()
    }

    #[cfg(test)]
    pub async fn listener_count(&self) -> usize {
        self.inner.read().await.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_member_hears_their_own_change_and_not_someone_elses() {
        let hub = Hub::new();
        let mut vera = hub.subscribe("m-vera").await;
        let mut sam = hub.subscribe("m-sam").await;

        hub.send_to("m-vera", Event::GrantsChanged { epoch: 4 }).await;

        assert_eq!(vera.recv().await.unwrap(), Event::GrantsChanged { epoch: 4 });
        assert!(sam.try_recv().is_err(), "Sam's rights did not change");
    }

    #[tokio::test]
    async fn every_window_of_one_member_hears_it() {
        let hub = Hub::new();
        let mut one = hub.subscribe("m-vera").await;
        let mut two = hub.subscribe("m-vera").await;

        hub.send_to("m-vera", Event::Revoked).await;

        assert_eq!(one.recv().await.unwrap(), Event::Revoked);
        assert_eq!(two.recv().await.unwrap(), Event::Revoked);
    }

    #[tokio::test]
    async fn the_listeners_are_those_still_listening() {
        let hub = Hub::new();
        let _vera = hub.subscribe("m-vera").await;
        let sam = hub.subscribe("m-sam").await;
        drop(sam);

        assert_eq!(hub.listeners().await, vec!["m-vera".to_string()]);
    }

    #[tokio::test]
    async fn a_change_to_my_own_space_reaches_me_alone() {
        let hub = Hub::new();
        let mut vera = hub.subscribe("m-vera").await;
        let mut sam = hub.subscribe("m-sam").await;
        let mine = Event::PersonalChanged { what: "profile", id: "p1".into() };

        hub.send_to("m-vera", mine.clone()).await;

        assert_eq!(vera.recv().await.unwrap(), mine);
        assert!(sam.try_recv().is_err(), "it is not Sam's space");
    }

    #[test]
    fn each_event_names_its_kind_on_the_wire() {
        let wire = |e: Event| serde_json::to_value(e).unwrap();
        assert_eq!(
            wire(Event::PersonalChanged { what: "proxy", id: "x1".into() }),
            serde_json::json!({ "kind": "personal-changed", "what": "proxy", "id": "x1" })
        );
        assert_eq!(
            wire(Event::TeamChanged { what: "proxy", id: "x1".into() }),
            serde_json::json!({ "kind": "team-changed", "what": "proxy", "id": "x1" })
        );
        // A re-issue is its own kind, never read as a removal.
        assert_eq!(wire(Event::TokenReplaced), serde_json::json!({ "kind": "token-replaced" }));
        assert_eq!(wire(Event::Revoked), serde_json::json!({ "kind": "revoked" }));
    }

    #[tokio::test]
    async fn a_member_keeps_so_many_sockets_and_a_new_one_closes_the_oldest() {
        let hub = Hub::new();
        let first = hub.seat("m-vera", 2);
        let second = hub.seat("m-vera", 2);
        let sams = hub.seat("m-sam", 2);
        let third = hub.seat("m-vera", 2);
        // The oldest of hers is told; it may already be waiting or not yet.
        tokio::time::timeout(std::time::Duration::from_secs(1), first.closed.notified()).await.unwrap();
        for kept in [&second, &third, &sams] {
            assert!(tokio::time::timeout(std::time::Duration::from_millis(50), kept.closed.notified()).await.is_err());
        }
        // A socket that went on its own leaves room.
        drop(second);
        let fourth = hub.seat("m-vera", 2);
        assert!(tokio::time::timeout(std::time::Duration::from_millis(50), third.closed.notified()).await.is_err());
        drop((first, third, fourth, sams));
        assert!(hub.seats.lock().unwrap().is_empty(), "nothing left behind");
    }

    #[tokio::test]
    async fn sending_to_nobody_is_not_an_error() {
        let hub = Hub::new();
        // Never connected at all.
        hub.send_to("m-nobody", Event::Revoked).await;

        // Connected and then gone: the entry is cleaned up rather than kept.
        let rx = hub.subscribe("m-left").await;
        drop(rx);
        hub.send_to("m-left", Event::Revoked).await;
        assert_eq!(hub.listener_count().await, 0);
    }
}

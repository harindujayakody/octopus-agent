//! Octopus Agent team server — the binary: its setup from the environment,
//! then [`Server::serve`] until Ctrl-C.
//!
//! * `SHARDBROWSER_TEAM_DATA_DIR` — the directory holding `team.sqlite` and
//!   `server.key`. Default `./data`, made if it is not there. Back up both,
//!   together: the database without its key is unreadable by design.
//! * `SHARDBROWSER_TEAM_BIND` — host and port to listen on. Default
//!   `127.0.0.1:8787`.
//! * `SHARDBROWSER_TEAM_NAME` — the team's name, read on the first run only
//!   (`PATCH /admin/team` renames it later). Default `Team`.
//! * `SHARDBROWSER_TEAM_TRASH_DAYS` — how many days a deleted team item stays
//!   in the trash before it is purged. Default 30.
//! * `SHARDBROWSER_TEAM_PUBLIC_URL` — the address launchers reach the server
//!   at, as the printed invite starts with it. Default `http://` and the bind
//!   address. Given, the admin's launcher starts member invites with it too.
//!
//! The old `SHARDX_TEAM_*` names still work when the new one is not set, with
//! a warning in the log.
//!
//! `--print-invite` prints a fresh admin invite for the team in the data
//! directory and exits; the server may be running meanwhile.
//!
//! Launchers reach it at plain `http://`, then switch the connection to TLS
//! with the team's own key (`team-wire`): no certificate or domain to set up.
//! Only `GET /health` answers in the clear, and only that the server is up.
//!
//! `RUST_LOG` picks the log level, `info` if it says nothing.

use std::io::IsTerminal;
use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use shardbrowser_team_server::{Config, PublicUrl, Server, DEFAULT_TRASH_DAYS};
use tokio::net::TcpListener;

/// A setting's environment variable, and its old `SHARDX_TEAM_*` name, still read.
struct Var {
    name: &'static str,
    old: &'static str,
}

const ENV_DATA_DIR: Var = Var { name: "SHARDBROWSER_TEAM_DATA_DIR", old: "SHARDX_TEAM_DATA_DIR" };
const ENV_BIND: Var = Var { name: "SHARDBROWSER_TEAM_BIND", old: "SHARDX_TEAM_BIND" };
const ENV_TEAM_NAME: Var = Var { name: "SHARDBROWSER_TEAM_NAME", old: "SHARDX_TEAM_NAME" };
const ENV_TRASH_DAYS: Var = Var { name: "SHARDBROWSER_TEAM_TRASH_DAYS", old: "SHARDX_TEAM_TRASH_DAYS" };
const ENV_PUBLIC_URL: Var = Var { name: "SHARDBROWSER_TEAM_PUBLIC_URL", old: "SHARDX_TEAM_PUBLIC_URL" };

impl Var {
    /// The value under the new name, else under the old one; `true` when it was the old one.
    fn lookup(&self, env: impl Fn(&str) -> Option<String>) -> Option<(String, bool)> {
        env(self.name).map(|v| (v, false)).or_else(|| env(self.old).map(|v| (v, true)))
    }

    /// From this process's environment; a value under the old name logs that it is deprecated.
    fn get(&self) -> Option<String> {
        let (value, old) = self.lookup(|k| std::env::var(k).ok())?;
        if old {
            tracing::warn!("{} is deprecated: use {} instead", self.old, self.name);
        }
        Some(value)
    }
}

const USAGE: &str = "\
Usage: octopus-agent-team-server [--print-invite]

  (no flag)       serve the team in SHARDBROWSER_TEAM_DATA_DIR on SHARDBROWSER_TEAM_BIND
  --print-invite  print a fresh admin invite for that team, then exit
";

/// What the command line asks for.
#[derive(Debug, PartialEq, Eq)]
enum Mode {
    Serve,
    PrintInvite,
    Help,
}

fn mode(args: impl IntoIterator<Item = String>) -> Result<Mode> {
    let mut mode = Mode::Serve;
    for a in args {
        mode = match (mode, a.as_str()) {
            (_, "-h" | "--help") => Mode::Help,
            (Mode::Help, _) => Mode::Help,
            (_, "--print-invite") => Mode::PrintInvite,
            (_, other) => bail!("unknown argument {other:?}\n\n{USAGE}"),
        };
    }
    Ok(mode)
}

const DEFAULT_DATA_DIR: &str = "./data";
/// Loopback, because this is somebody's own machine: facing the open internet
/// should be a decision the owner makes, not one we make for them.
const DEFAULT_BIND: &str = "127.0.0.1:8787";

#[tokio::main]
async fn main() -> Result<()> {
    let mode = mode(std::env::args().skip(1))?;
    if mode == Mode::Help {
        print!("{USAGE}");
        return Ok(());
    }
    // No colour codes where nobody reads them as colour: `docker logs`, a file.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .with_ansi(std::io::stdout().is_terminal())
        .init();

    let bind = ENV_BIND.get().unwrap_or_else(|| DEFAULT_BIND.to_string());
    let url = PublicUrl::new(ENV_PUBLIC_URL.get().as_deref(), &bind)?;
    let cfg = Config {
        data_dir: PathBuf::from(ENV_DATA_DIR.get().unwrap_or_else(|| DEFAULT_DATA_DIR.to_string())),
        team_name: ENV_TEAM_NAME.get(),
        trash_days: trash_days(ENV_TRASH_DAYS.get().as_deref())?,
        url: Some(url.clone()),
    };

    if mode == Mode::PrintInvite {
        // A wrong directory would quietly make a second team; say so instead.
        let db = cfg.data_dir.join("team.sqlite");
        if !db.exists() {
            bail!(
                "no team in {}: point {} at the server's data directory",
                cfg.data_dir.display(),
                ENV_DATA_DIR.name
            );
        }
        let server = Server::open(&cfg, &mut std::io::sink()).context("open the team")?;
        return server.print_invite(&url, &mut std::io::stdout().lock());
    }

    let server = Server::open(&cfg, &mut std::io::stdout().lock())
        .context("start the team server")?;

    let listener = TcpListener::bind(&bind)
        .await
        .with_context(|| format!("listen on {bind}"))?;
    tracing::info!(
        "team {} on {} — {}",
        server.team_id(),
        listener.local_addr()?,
        server.db_path().display()
    );

    // Stop accepting and let the requests already in flight answer.
    server
        .serve(listener, async {
            stop_asked().await;
            tracing::info!("stopping: finishing the requests already in flight");
        })
        .await
        .context("serve")?;

    tracing::info!("stopped");
    Ok(())
}

/// Ctrl-C, or SIGTERM, which is how `docker stop` and systemd ask.
async fn stop_asked() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        if let Ok(mut term) = signal(SignalKind::terminate()) {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = term.recv() => {}
            }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}

/// Days in the trash: unset or blank is the default, anything else a whole number.
fn trash_days(raw: Option<&str>) -> Result<u64> {
    match raw.map(str::trim) {
        None | Some("") => Ok(DEFAULT_TRASH_DAYS),
        Some(v) => v
            .parse()
            .with_context(|| format!("{} is not a whole number of days: {v:?}", ENV_TRASH_DAYS.name)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trash_days_come_from_the_environment_or_the_default() {
        assert_eq!(trash_days(None).unwrap(), DEFAULT_TRASH_DAYS);
        assert_eq!(trash_days(Some("  ")).unwrap(), DEFAULT_TRASH_DAYS);
        assert_eq!(trash_days(Some(" 7 ")).unwrap(), 7);
        assert_eq!(trash_days(Some("0")).unwrap(), 0);
        for bad in ["-1", "seven", "1.5"] {
            assert!(trash_days(Some(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_new_name_wins_and_the_old_one_is_still_read() {
        let env = |set: &'static [(&'static str, &'static str)]| {
            move |k: &str| set.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string())
        };
        let both = env(&[("SHARDBROWSER_TEAM_BIND", "0.0.0.0:1"), ("SHARDX_TEAM_BIND", "0.0.0.0:2")]);
        assert_eq!(ENV_BIND.lookup(both), Some(("0.0.0.0:1".into(), false)));
        let old = env(&[("SHARDX_TEAM_BIND", "0.0.0.0:2")]);
        assert_eq!(ENV_BIND.lookup(old), Some(("0.0.0.0:2".into(), true)));
        assert_eq!(ENV_BIND.lookup(env(&[("SHARDX_TEAM_NAME", "Ads")])), None);
        // Each setting's old name is its new one under the old prefix.
        for v in [&ENV_DATA_DIR, &ENV_BIND, &ENV_TEAM_NAME, &ENV_TRASH_DAYS, &ENV_PUBLIC_URL] {
            let rest = v.name.strip_prefix("SHARDBROWSER_TEAM_").expect(v.name);
            assert_eq!(v.old, format!("SHARDX_TEAM_{rest}"));
        }
    }

    #[test]
    fn the_command_line_serves_prints_an_invite_or_explains_itself() {
        let args = |a: &[&str]| mode(a.iter().map(|s| s.to_string()));
        assert_eq!(args(&[]).unwrap(), Mode::Serve);
        assert_eq!(args(&["--print-invite"]).unwrap(), Mode::PrintInvite);
        assert_eq!(args(&["--help"]).unwrap(), Mode::Help);
        assert_eq!(args(&["--print-invite", "-h"]).unwrap(), Mode::Help);
        let e = args(&["--print-invites"]).unwrap_err().to_string();
        assert!(e.contains("--print-invites") && e.contains("Usage:"), "{e}");
    }
}

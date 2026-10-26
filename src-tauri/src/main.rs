// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `--reap <ppid> <dir>`: the guard of a team profile, not the app.
    if let Some(code) = octopus_agent_lib::reap_if_asked() {
        std::process::exit(code);
    }
    octopus_agent_lib::run()
}

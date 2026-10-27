//! The extensions profiles installed by themselves, listed beside the library.

use crate::space::extensions::{self, InProfile};

/// Every extension the personal profiles installed inside their browsers.
#[tauri::command]
pub async fn extensions_in_profiles() -> Result<Vec<InProfile>, String> {
    tokio::task::spawn_blocking(extensions::in_profiles)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

//! Connection passwords stored in the OS credential store.
//!
//! Entries are keyed by connection id under a single service name, so a
//! profile's secret survives app restarts without HyperStudio holding a key
//! of its own. Nothing is written to disk by this module.

use keyring::v1::{Entry, Error as KeyringError};

const SERVICE: &str = "com.hyperstudio.app";

fn entry(connection_id: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, connection_id).map_err(describe)
}

fn describe(error: KeyringError) -> String {
    match error {
        KeyringError::NoStorageAccess(inner) => {
            format!("The OS credential store refused access: {inner}")
        }
        KeyringError::PlatformFailure(inner) => {
            format!("The OS credential store failed: {inner}")
        }
        other => other.to_string(),
    }
}

/// Whether a credential store exists and is reachable on this machine.
#[tauri::command]
pub async fn keychain_available() -> bool {
    Entry::new(SERVICE, "__probe__").is_ok()
}

#[tauri::command]
pub async fn keychain_set(connection_id: String, password: String) -> Result<(), String> {
    entry(&connection_id)?
        .set_password(&password)
        .map_err(describe)
}

/// Returns None when the connection has no stored password.
#[tauri::command]
pub async fn keychain_get(connection_id: String) -> Result<Option<String>, String> {
    match entry(&connection_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(describe(error)),
    }
}

/// Deleting a password that was never stored is not an error.
#[tauri::command]
pub async fn keychain_delete(connection_id: String) -> Result<(), String> {
    match entry(&connection_id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(describe(error)),
    }
}

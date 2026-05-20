//! Read / write git config keys. Used by the Settings panel to expose
//! a few user-relevant knobs (most notably `core.autocrlf`).
//!
//! Scope:
//! - "local"  — repo's `.git/config`
//! - "global" — user's `~/.gitconfig`
//! Reads always fall back to the merged config (local overrides global).

use git2::{Config, Repository};

/// Read a config key from the merged view (local overrides global).
/// Returns Ok(None) if the key isn't set anywhere.
pub fn get(path: &str, key: &str) -> Result<Option<String>, git2::Error> {
    let repo = Repository::discover(path)?;
    let cfg = repo.config()?;
    match cfg.get_string(key) {
        Ok(v) => Ok(Some(v)),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Set a config key.
/// `scope` must be "local" or "global". Empty `value` deletes the entry
/// (so the merged value falls through to the next scope).
pub fn set(path: &str, key: &str, value: &str, scope: &str) -> Result<(), git2::Error> {
    let mut cfg = open_scoped(path, scope)?;
    if value.is_empty() {
        match cfg.remove(key) {
            Ok(()) => Ok(()),
            // Not-found while deleting is a no-op success.
            Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    } else {
        cfg.set_str(key, value)
    }
}

fn open_scoped(path: &str, scope: &str) -> Result<Config, git2::Error> {
    match scope {
        "local" => {
            let repo = Repository::discover(path)?;
            // Snapshot of the local file only — we want set_str to write here.
            repo.config()?.open_level(git2::ConfigLevel::Local)
        }
        "global" => Config::open_default()?.open_level(git2::ConfigLevel::Global),
        other => Err(git2::Error::from_str(&format!(
            "unknown config scope '{}', expected local|global",
            other
        ))),
    }
}

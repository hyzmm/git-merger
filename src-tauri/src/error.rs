//! Structured application error type returned from every `#[tauri::command]`.
//!
//! The frontend deserialises this into a tagged `AppError` object so it can
//! react to specific failure shapes (e.g. show a "non-fast-forward" guide
//! instead of a generic toast) without parsing free-form strings.
//!
//! Conversion rules from `git2::Error` are intentionally conservative — we
//! only promote a few well-known codes/messages to dedicated `kind`s; every
//! other libgit2 failure stays under `Kind::Git`. Inner library functions
//! continue to return `Result<T, git2::Error>`, so this module is the *only*
//! place where the `AppError` shape lives.

use serde::Serialize;
use std::fmt;

/// Tagged failure category surfaced to the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Kind {
    /// libgit2 reports the object/ref/path was not found.
    NotFound,
    /// libgit2 reports a conflict on the index (merge / cherry-pick / revert / rebase).
    MergeConflict,
    /// `pull` analysis returned non-fast-forward and we refuse to merge automatically.
    NonFastForward,
    /// All credential strategies (SSH agent / keys / helper / prompt) failed.
    Auth,
    /// User dismissed the credential dialog or aborted a long-running op.
    UserCancelled,
    /// Caller passed something the command rejects up-front (bad mode, bad oid string, etc.).
    InvalidArgument,
    /// Catch-all for libgit2 errors that don't map to a more specific kind.
    Git,
    /// `std::io::Error` (read/write/rename of files outside libgit2's purview).
    Io,
    /// Bug-level: serialisation / poisoned mutex / unreachable invariants.
    Internal,
    /// Plain-string fallback for legacy call sites; new code should prefer a real kind.
    Other,
}

impl Kind {
    /// Stable identifier used by the frontend (matches the JSON tag).
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::NotFound => "NotFound",
            Kind::MergeConflict => "MergeConflict",
            Kind::NonFastForward => "NonFastForward",
            Kind::Auth => "Auth",
            Kind::UserCancelled => "UserCancelled",
            Kind::InvalidArgument => "InvalidArgument",
            Kind::Git => "Git",
            Kind::Io => "Io",
            Kind::Internal => "Internal",
            Kind::Other => "Other",
        }
    }
}

/// Structured error returned to the frontend. Serialises as a plain object:
/// `{ kind, message, code?, class? }` — the optional fields are absent when
/// `None`, so the JSON payload stays small and stable.
#[derive(Debug, Clone)]
pub struct AppError {
    pub kind: Kind,
    pub message: String,
    /// Stringified `git2::ErrorCode` when the source was a libgit2 error.
    pub code: Option<String>,
    /// Stringified `git2::ErrorClass` when the source was a libgit2 error.
    pub class: Option<String>,
}

impl AppError {
    /// Build a fresh error from a `Kind` and a human-readable message.
    pub fn new(kind: Kind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            code: None,
            class: None,
        }
    }

    /// Convenience constructor for InvalidArgument errors.
    #[allow(dead_code)]
    pub fn invalid_argument(message: impl Into<String>) -> Self {
        Self::new(Kind::InvalidArgument, message)
    }

    /// Convenience constructor for Internal errors.
    #[allow(dead_code)]
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(Kind::Internal, message)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.kind.as_str(), self.message)
    }
}

impl std::error::Error for AppError {}

// ---------- From conversions ----------

/// Map a libgit2 error to the closest `Kind`. The matching is deliberately
/// conservative: anything we don't explicitly recognise stays as `Kind::Git`
/// so the original libgit2 message is preserved.
fn classify_git_error(e: &git2::Error) -> Kind {
    use git2::ErrorCode as C;
    match e.code() {
        C::NotFound => Kind::NotFound,
        C::Conflict | C::MergeConflict => Kind::MergeConflict,
        C::Auth | C::Certificate => Kind::Auth,
        C::User => Kind::UserCancelled,
        C::Invalid | C::InvalidSpec => Kind::InvalidArgument,
        _ => {
            // Fall back to message-based heuristics for `from_str` errors that
            // libgit2 itself stamps with `ErrorCode::GenericError`.
            let msg = e.message();
            let lower = msg.to_ascii_lowercase();
            if lower.contains("non-fast-forward") {
                Kind::NonFastForward
            } else if lower.contains("authentication required")
                || lower.contains("no usable credentials")
            {
                Kind::Auth
            } else if lower.contains("cancel")
                || lower.contains("user dismissed")
                || lower.contains("user aborted")
            {
                Kind::UserCancelled
            } else if lower.starts_with("unknown reset mode")
                || lower.starts_with("unknown config scope")
                || lower.contains("invalid pattern")
            {
                Kind::InvalidArgument
            } else {
                Kind::Git
            }
        }
    }
}

impl From<git2::Error> for AppError {
    fn from(e: git2::Error) -> Self {
        let kind = classify_git_error(&e);
        Self {
            kind,
            message: e.message().to_string(),
            code: Some(format!("{:?}", e.code())),
            class: Some(format!("{:?}", e.class())),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::new(Kind::Io, e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::new(Kind::Internal, format!("serde_json: {e}"))
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        Self::new(Kind::Other, s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        Self::new(Kind::Other, s.to_string())
    }
}

// ---------- Serialisation ----------
//
// Manual `Serialize` so absent `code` / `class` fields are omitted entirely
// rather than serialised as `null`, keeping the wire format compact.
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = s.serialize_map(None)?;
        map.serialize_entry("kind", self.kind.as_str())?;
        map.serialize_entry("message", &self.message)?;
        if let Some(c) = &self.code {
            map.serialize_entry("code", c)?;
        }
        if let Some(c) = &self.class {
            map.serialize_entry("class", c)?;
        }
        map.end()
    }
}

// ---------- Tests ----------

#[cfg(test)]
mod tests {
    use super::*;

    fn json(e: &AppError) -> String {
        serde_json::to_string(e).expect("serialize AppError")
    }

    #[test]
    fn classifies_not_found() {
        let g = git2::Error::new(
            git2::ErrorCode::NotFound,
            git2::ErrorClass::Reference,
            "ref does not exist",
        );
        let e: AppError = g.into();
        assert_eq!(e.kind, Kind::NotFound);
        assert!(e.message.contains("ref does not exist"));
        assert_eq!(e.code.as_deref(), Some("NotFound"));
        assert_eq!(e.class.as_deref(), Some("Reference"));
    }

    #[test]
    fn classifies_merge_conflict() {
        let g = git2::Error::new(
            git2::ErrorCode::Conflict,
            git2::ErrorClass::Merge,
            "conflicts prevent checkout",
        );
        let e: AppError = g.into();
        assert_eq!(e.kind, Kind::MergeConflict);
    }

    #[test]
    fn classifies_auth_via_code() {
        let g = git2::Error::new(
            git2::ErrorCode::Auth,
            git2::ErrorClass::Http,
            "auth required",
        );
        let e: AppError = g.into();
        assert_eq!(e.kind, Kind::Auth);
    }

    #[test]
    fn classifies_invalid_argument_via_code() {
        let g = git2::Error::new(
            git2::ErrorCode::Invalid,
            git2::ErrorClass::Tree,
            "invalid spec",
        );
        let e: AppError = g.into();
        assert_eq!(e.kind, Kind::InvalidArgument);
    }

    #[test]
    fn classifies_user_cancel_via_code() {
        let g = git2::Error::new(git2::ErrorCode::User, git2::ErrorClass::Net, "user aborted");
        let e: AppError = g.into();
        assert_eq!(e.kind, Kind::UserCancelled);
    }

    #[test]
    fn classifies_non_ff_via_message_heuristic() {
        // `git2::Error::from_str` produces GenericError; we fall back to the
        // message heuristic.
        let g = git2::Error::from_str("non-fast-forward — use the merge UI");
        let e: AppError = g.into();
        assert_eq!(e.kind, Kind::NonFastForward);
    }

    #[test]
    fn classifies_unknown_reset_mode_via_heuristic() {
        let g = git2::Error::from_str("unknown reset mode 'oops', expected soft/mixed/hard");
        let e: AppError = g.into();
        assert_eq!(e.kind, Kind::InvalidArgument);
    }

    #[test]
    fn classifies_no_usable_credentials_via_heuristic() {
        let g = git2::Error::from_str("authentication required (no usable credentials)");
        let e: AppError = g.into();
        assert_eq!(e.kind, Kind::Auth);
    }

    #[test]
    fn unknown_libgit2_message_falls_back_to_git() {
        let g = git2::Error::from_str("something obscure exploded");
        let e: AppError = g.into();
        assert_eq!(e.kind, Kind::Git);
        assert_eq!(e.message, "something obscure exploded");
    }

    #[test]
    fn io_error_maps_to_io_kind() {
        let io = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
        let e: AppError = io.into();
        assert_eq!(e.kind, Kind::Io);
        assert!(e.message.contains("denied"));
    }

    #[test]
    fn json_omits_optional_fields_when_absent() {
        let e = AppError::invalid_argument("bad oid");
        let body = json(&e);
        // No git2 source, so neither code nor class should appear.
        assert!(body.contains("\"kind\":\"InvalidArgument\""));
        assert!(body.contains("\"message\":\"bad oid\""));
        assert!(!body.contains("\"code\""));
        assert!(!body.contains("\"class\""));
    }

    #[test]
    fn json_includes_code_and_class_when_from_git2() {
        let g = git2::Error::new(git2::ErrorCode::NotFound, git2::ErrorClass::Reference, "x");
        let e: AppError = g.into();
        let body = json(&e);
        assert!(body.contains("\"kind\":\"NotFound\""));
        assert!(body.contains("\"code\":\"NotFound\""));
        assert!(body.contains("\"class\":\"Reference\""));
    }

    #[test]
    fn display_includes_kind_and_message() {
        let e = AppError::new(Kind::Internal, "boom");
        assert_eq!(format!("{e}"), "Internal: boom");
    }
}

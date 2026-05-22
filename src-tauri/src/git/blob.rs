//! Raw-bytes accessors for image previews in the diff viewer.
//!
//! For text files the existing `diff::file_diff` / `diff::working_diff`
//! commands are perfect — but they refuse binary blobs. The Image-diff
//! pane needs the actual decoded bytes on each side so it can render
//! `<img src="data:...;base64,...">` with the OLD blob on the left and
//! the NEW blob on the right.
//!
//! Both functions cap the returned payload at 8 MB (matching
//! `workspace::MAX_FILE_BYTES`) to keep the IPC channel small and the
//! frontend snappy. Anything larger is reported via `oversized: true`
//! with no payload, so the UI can show "image too large to preview"
//! without trying to draw something useless.

use base64::Engine as _;
use git2::Repository;
use serde::{Deserialize, Serialize};

const MAX_BLOB_BYTES: usize = 8 * 1024 * 1024; // 8 MB

#[derive(Debug, Serialize, Deserialize)]
pub struct BlobPayload {
    /// True when the blob doesn't exist on this side (e.g. file added/deleted).
    pub missing: bool,
    /// True when size > MAX_BLOB_BYTES; `data_b64` is then empty.
    pub oversized: bool,
    /// Total uncompressed byte count (always reported, even when oversized).
    pub size: usize,
    /// Standard base64 encoding of the bytes (no `data:` prefix). Empty
    /// when `missing` or `oversized`.
    pub data_b64: String,
}

fn encode_capped(bytes: &[u8]) -> BlobPayload {
    let size = bytes.len();
    if size > MAX_BLOB_BYTES {
        return BlobPayload {
            missing: false,
            oversized: true,
            size,
            data_b64: String::new(),
        };
    }
    BlobPayload {
        missing: false,
        oversized: false,
        size,
        data_b64: base64::engine::general_purpose::STANDARD.encode(bytes),
    }
}

/// Read the bytes of `file` as it existed at `oid`.
///
/// Returns a `missing` payload when the path doesn't exist at that
/// commit (e.g. the file was added in this commit, so the OLD side is
/// empty). Per-file lookup goes through `tree.get_path` so renames are
/// transparent to the caller — pass whichever path the diff entry uses
/// for that side.
pub fn read_blob_at_commit(path: &str, oid: &str, file: &str) -> Result<BlobPayload, git2::Error> {
    let repo = Repository::discover(path)?;
    let commit = repo.find_commit(git2::Oid::from_str(oid)?)?;
    let tree = commit.tree()?;

    let entry = match tree.get_path(std::path::Path::new(file)) {
        Ok(e) => e,
        Err(_) => {
            return Ok(BlobPayload {
                missing: true,
                oversized: false,
                size: 0,
                data_b64: String::new(),
            });
        }
    };
    let blob = repo.find_blob(entry.id())?;
    Ok(encode_capped(blob.content()))
}

/// Read the bytes of `file` as it currently exists in the working tree.
///
/// Returns `missing: true` when the file is absent from the workdir
/// (e.g. it was removed and the diff is showing a deletion).
pub fn read_working_blob(path: &str, file: &str) -> Result<BlobPayload, git2::Error> {
    let repo = Repository::discover(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| git2::Error::from_str("bare repo has no working tree"))?;
    let abs = workdir.join(file);
    if !abs.exists() {
        return Ok(BlobPayload {
            missing: true,
            oversized: false,
            size: 0,
            data_b64: String::new(),
        });
    }
    // Stat first so we never load >MAX_BLOB_BYTES into memory.
    let meta = std::fs::metadata(&abs).map_err(|e| git2::Error::from_str(&format!("stat: {e}")))?;
    let size = meta.len() as usize;
    if size > MAX_BLOB_BYTES {
        return Ok(BlobPayload {
            missing: false,
            oversized: true,
            size,
            data_b64: String::new(),
        });
    }
    let bytes = std::fs::read(&abs).map_err(|e| git2::Error::from_str(&format!("read: {e}")))?;
    Ok(encode_capped(&bytes))
}

//! Shared types + module exports for the git layer.

pub mod blame;
pub mod blob;
pub mod commit_ops;
pub mod commit_relations;
pub mod config;
pub mod diff;
pub mod file_history;
pub mod gitignore;
pub mod hooks;
pub mod log;
pub mod merge;
pub mod patch;
pub mod rebase;
pub mod reflog;
pub mod refs;
pub mod refs_ops;
pub mod remote;
pub mod repo;
pub mod search;
pub mod signing;
pub mod stash;
pub mod stats;
pub mod submodule;
pub mod workspace;
pub mod worktree;

pub use blame::{BlameLine, PrevFile};
pub use blob::BlobPayload;
pub use file_history::FileHistoryEntry;
pub use gitignore::{GitignoreTemplate, IgnorePreview};
pub use log::{CommitMeta, LogPage};
pub use merge::{ConflictContent, MergeState};
pub use rebase::{RebaseStatus, RebaseStep};
pub use reflog::ReflogEntry;
pub use refs::{RefEntry, TagInfo};
pub use remote::{CredReply, RemoteOpResult};
pub use search::{DiffHit, PatternKind, SearchHit, SearchMode, SearchSummary};
pub use signing::{CommitSignatureInfo, VerifyResult, VerifyState};
pub use stats::{StatsBranches, StatsChurn, StatsOverview};
pub use stash::StashEntry;
pub use submodule::SubmoduleInfo;
pub use workspace::{WorkingFile, WorkingFileText};
pub use worktree::WorktreeInfo;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct RepoInfo {
    pub path: String,
    pub head: Option<String>,
    pub is_bare: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitSummary {
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    /// unix seconds
    pub time: i64,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeStatus {
    Added,
    Deleted,
    Modified,
    Renamed,
    Copied,
    Typechange,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub old_path: Option<String>,
    pub status: ChangeStatus,
    pub insertions: usize,
    pub deletions: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffLine {
    /// One of " ", "+", "-"
    pub origin: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileDiff {
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub is_binary: bool,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConflictFile {
    pub path: String,
    pub ancestor: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
}

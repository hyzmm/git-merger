//! Tauri command surface — thin wrappers around the `git` module.

use crate::git;
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum CmdError {
    #[error("{0}")]
    Git(#[from] git2::Error),
    #[error("{0}")]
    Other(String),
}

impl Serialize for CmdError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

type R<T> = Result<T, CmdError>;

#[tauri::command]
pub fn open_repo(path: String) -> R<git::RepoInfo> {
    Ok(git::repo::open(&path)?)
}

#[tauri::command]
pub fn git_log(path: String, limit: usize, skip: usize) -> R<Vec<git::CommitSummary>> {
    Ok(git::log::log(&path, limit, skip)?)
}

#[tauri::command]
pub fn commit_files(path: String, oid: String) -> R<Vec<git::FileChange>> {
    Ok(git::diff::commit_files(&path, &oid)?)
}

#[tauri::command]
pub fn file_diff(path: String, oid: String, file: String) -> R<git::FileDiff> {
    Ok(git::diff::file_diff(&path, &oid, &file)?)
}

#[tauri::command]
pub fn working_diff(path: String, file: String) -> R<git::FileDiff> {
    Ok(git::diff::working_diff(&path, &file)?)
}

#[tauri::command]
pub fn conflicts(path: String) -> R<Vec<git::ConflictFile>> {
    Ok(git::merge::conflicts(&path)?)
}

#[tauri::command]
pub fn merge_state(path: String) -> R<git::MergeState> {
    Ok(git::merge::merge_state(&path)?)
}

#[tauri::command]
pub fn conflict_content(path: String, file: String) -> R<git::ConflictContent> {
    Ok(git::merge::conflict_content(&path, &file)?)
}

#[tauri::command]
pub fn resolve_conflict(path: String, file: String, content: String) -> R<()> {
    git::merge::resolve_conflict(&path, &file, &content)?;
    Ok(())
}

#[tauri::command]
pub fn abort_merge(path: String) -> R<()> {
    git::merge::abort_merge(&path)?;
    Ok(())
}

#[tauri::command]
pub fn commit_merge(path: String, message: Option<String>) -> R<String> {
    Ok(git::merge::commit_merge(&path, message.as_deref())?)
}

#[tauri::command]
pub fn list_refs(path: String) -> R<Vec<git::RefEntry>> {
    Ok(git::refs::list_refs(&path)?)
}

#[tauri::command]
pub fn blame_file(path: String, file: String) -> R<Vec<git::BlameLine>> {
    Ok(git::blame::blame_file(&path, &file)?)
}

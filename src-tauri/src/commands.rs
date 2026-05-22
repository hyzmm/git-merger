//! Tauri command surface — thin wrappers around the `git` module.
//!
//! Every command returns `Result<T, AppError>`. `AppError` is serialised as a
//! tagged JSON object (`{ kind, message, code?, class? }`), so the frontend
//! can react to specific failure shapes (e.g. `NonFastForward`, `Auth`)
//! without parsing free-form strings.

use crate::error::AppError;
use crate::git;

/// Local alias kept for brevity at every command site.
type R<T> = Result<T, AppError>;

#[tauri::command]
pub fn open_repo(path: String) -> R<git::RepoInfo> {
    Ok(git::repo::open(&path)?)
}

#[tauri::command]
pub fn tracked_files(path: String) -> R<Vec<String>> {
    Ok(git::repo::tracked_files(&path)?)
}

#[tauri::command]
pub fn file_history(
    path: String,
    file: String,
    limit: Option<usize>,
) -> R<Vec<git::FileHistoryEntry>> {
    Ok(git::file_history::file_history(
        &path,
        &file,
        limit.unwrap_or(2000),
    )?)
}

#[tauri::command]
pub fn git_log(
    path: String,
    limit: usize,
    skip: usize,
    pathspec: Option<String>,
) -> R<Vec<git::CommitSummary>> {
    Ok(git::log::log(&path, limit, skip, pathspec.as_deref())?)
}

#[tauri::command]
pub fn git_log_page(
    path: String,
    after: Option<String>,
    limit: usize,
    pathspec: Option<String>,
) -> R<git::LogPage> {
    Ok(git::log::log_page(
        &path,
        after.as_deref(),
        limit,
        pathspec.as_deref(),
    )?)
}

#[tauri::command]
pub fn commit_files(path: String, oid: String) -> R<Vec<git::FileChange>> {
    Ok(git::diff::commit_files(&path, &oid)?)
}

#[tauri::command]
pub fn file_diff(
    path: String,
    oid: String,
    file: String,
    ignore_whitespace: bool,
) -> R<git::FileDiff> {
    Ok(git::diff::file_diff(&path, &oid, &file, ignore_whitespace)?)
}

#[tauri::command]
pub fn working_diff(path: String, file: String, ignore_whitespace: bool) -> R<git::FileDiff> {
    Ok(git::diff::working_diff(&path, &file, ignore_whitespace)?)
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

#[tauri::command]
pub fn blame_at_revision(path: String, file: String, revision: String) -> R<Vec<git::BlameLine>> {
    Ok(git::blame::blame_at_revision(&path, &file, &revision)?)
}

#[tauri::command]
pub fn previous_filename(
    path: String,
    file: String,
    at_revision: String,
) -> R<Option<git::PrevFile>> {
    Ok(git::blame::previous_filename(&path, &file, &at_revision)?)
}

#[tauri::command]
pub fn working_changes(path: String) -> R<Vec<git::WorkingFile>> {
    Ok(git::workspace::working_changes(&path)?)
}

#[tauri::command]
pub fn stage_files(path: String, paths: Vec<String>) -> R<()> {
    git::workspace::stage_files(&path, &paths)?;
    Ok(())
}

#[tauri::command]
pub fn unstage_files(path: String, paths: Vec<String>) -> R<()> {
    git::workspace::unstage_files(&path, &paths)?;
    Ok(())
}

#[tauri::command]
pub fn discard_files(path: String, paths: Vec<String>) -> R<()> {
    git::workspace::discard_files(&path, &paths)?;
    Ok(())
}

#[tauri::command]
pub fn commit_changes(path: String, message: String) -> R<String> {
    Ok(git::workspace::commit_changes(&path, &message)?)
}

// ---------- Working-tree file editor (v0.13.3) ----------

#[tauri::command]
pub fn read_working_file(path: String, file: String) -> R<git::WorkingFileText> {
    Ok(git::workspace::read_working_file(&path, &file)?)
}

#[tauri::command]
pub fn read_head_file(path: String, file: String) -> R<git::WorkingFileText> {
    Ok(git::workspace::read_head_file(&path, &file)?)
}

#[tauri::command]
pub fn write_working_file(path: String, file: String, content: String) -> R<()> {
    git::workspace::write_working_file(&path, &file, &content)?;
    Ok(())
}

// ---------- Patch I/O (v0.13.9) ----------

#[tauri::command]
pub fn format_commit_file_patch(path: String, oid: String, file: String) -> R<String> {
    Ok(git::patch::format_commit_file_patch(&path, &oid, &file)?)
}

#[tauri::command]
pub fn format_working_file_patch(path: String, file: String) -> R<String> {
    Ok(git::patch::format_working_file_patch(&path, &file)?)
}

#[tauri::command]
pub fn apply_patch_check(path: String, patch_text: String) -> R<()> {
    git::patch::apply_patch_check(&path, &patch_text)?;
    Ok(())
}

#[tauri::command]
pub fn apply_patch(path: String, patch_text: String) -> R<()> {
    git::patch::apply_patch(&path, &patch_text)?;
    Ok(())
}

#[tauri::command]
pub fn git_fetch(
    app: tauri::AppHandle,
    path: String,
    remote: Option<String>,
) -> R<git::RemoteOpResult> {
    Ok(git::remote::fetch(app, &path, remote.as_deref())?)
}

#[tauri::command]
pub fn git_pull(app: tauri::AppHandle, path: String) -> R<git::RemoteOpResult> {
    Ok(git::remote::pull(app, &path)?)
}

#[tauri::command]
pub fn git_push(
    app: tauri::AppHandle,
    path: String,
    remote: Option<String>,
    branch: Option<String>,
    set_upstream: bool,
) -> R<git::RemoteOpResult> {
    Ok(git::remote::push(
        app,
        &path,
        remote.as_deref(),
        branch.as_deref(),
        set_upstream,
    )?)
}

#[tauri::command]
pub fn submit_credentials(id: u64, reply: git::CredReply) -> R<()> {
    git::remote::submit_credentials(id, reply);
    Ok(())
}

#[tauri::command]
pub fn cancel_credentials(id: u64) -> R<()> {
    git::remote::cancel_credentials(id);
    Ok(())
}

#[tauri::command]
pub fn cancel_remote_op(op_id: u64) -> R<()> {
    git::remote::cancel_remote_op(op_id);
    Ok(())
}

// ---------- Stash ----------

#[tauri::command]
pub fn stash_list(path: String) -> R<Vec<git::StashEntry>> {
    Ok(git::stash::list(&path)?)
}

#[tauri::command]
pub fn stash_save(
    path: String,
    message: Option<String>,
    include_untracked: bool,
    keep_index: bool,
) -> R<String> {
    Ok(git::stash::save(
        &path,
        message.as_deref(),
        include_untracked,
        keep_index,
    )?)
}

#[tauri::command]
pub fn stash_apply(path: String, index: usize) -> R<()> {
    git::stash::apply(&path, index)?;
    Ok(())
}

#[tauri::command]
pub fn stash_pop(path: String, index: usize) -> R<()> {
    git::stash::pop(&path, index)?;
    Ok(())
}

#[tauri::command]
pub fn stash_drop(path: String, index: usize) -> R<()> {
    git::stash::drop(&path, index)?;
    Ok(())
}

// ---------- Branch / Tag operations ----------

#[tauri::command]
pub fn create_branch(path: String, name: String, start_point: String, checkout: bool) -> R<()> {
    git::refs_ops::create_branch(&path, &name, &start_point, checkout)?;
    Ok(())
}

#[tauri::command]
pub fn checkout_branch(path: String, name: String) -> R<()> {
    git::refs_ops::checkout_branch(&path, &name)?;
    Ok(())
}

#[tauri::command]
pub fn checkout_commit(path: String, oid: String) -> R<()> {
    git::refs_ops::checkout_commit(&path, &oid)?;
    Ok(())
}

#[tauri::command]
pub fn delete_branch(path: String, name: String) -> R<()> {
    git::refs_ops::delete_branch(&path, &name)?;
    Ok(())
}

#[tauri::command]
pub fn rename_branch(path: String, old_name: String, new_name: String) -> R<()> {
    git::refs_ops::rename_branch(&path, &old_name, &new_name)?;
    Ok(())
}

#[tauri::command]
pub fn create_tag(path: String, name: String, target: String, message: Option<String>) -> R<()> {
    git::refs_ops::create_tag(&path, &name, &target, message.as_deref())?;
    Ok(())
}

#[tauri::command]
pub fn delete_tag(path: String, name: String) -> R<()> {
    git::refs_ops::delete_tag(&path, &name)?;
    Ok(())
}

// ---------- Commit operations ----------

#[tauri::command]
pub fn cherry_pick(path: String, oid: String) -> R<()> {
    git::commit_ops::cherry_pick(&path, &oid)?;
    Ok(())
}

#[tauri::command]
pub fn revert_commit(path: String, oid: String) -> R<()> {
    git::commit_ops::revert(&path, &oid)?;
    Ok(())
}

#[tauri::command]
pub fn reset_to(path: String, oid: String, mode: String) -> R<()> {
    git::commit_ops::reset(&path, &oid, &mode)?;
    Ok(())
}

// ---------- Reflog ----------

#[tauri::command]
pub fn reflog_list(path: String, refname: Option<String>) -> R<Vec<git::ReflogEntry>> {
    Ok(git::reflog::list(&path, refname.as_deref())?)
}

// ---------- Submodules ----------

#[tauri::command]
pub fn submodule_list(path: String) -> R<Vec<git::SubmoduleInfo>> {
    Ok(git::submodule::list(&path)?)
}

#[tauri::command]
pub fn submodule_init(path: String, name: String) -> R<()> {
    git::submodule::init(&path, &name)?;
    Ok(())
}

#[tauri::command]
pub fn submodule_update(path: String, name: String, init_first: bool) -> R<()> {
    git::submodule::update(&path, &name, init_first)?;
    Ok(())
}

#[tauri::command]
pub fn submodule_sync(path: String, name: String) -> R<()> {
    git::submodule::sync(&path, &name)?;
    Ok(())
}

// ---------- Config ----------

#[tauri::command]
pub fn config_get(path: String, key: String) -> R<Option<String>> {
    Ok(git::config::get(&path, &key)?)
}

#[tauri::command]
pub fn config_set(path: String, key: String, value: String, scope: String) -> R<()> {
    git::config::set(&path, &key, &value, &scope)?;
    Ok(())
}

// ---------- Interactive Rebase ----------

#[tauri::command]
pub fn rebase_plan(path: String, base_oid: String) -> R<Vec<git::RebaseStep>> {
    Ok(git::rebase::plan(&path, &base_oid)?)
}

#[tauri::command]
pub fn rebase_start(
    path: String,
    base_oid: String,
    steps: Vec<git::RebaseStep>,
) -> R<git::RebaseStatus> {
    Ok(git::rebase::start(&path, &base_oid, steps)?)
}

#[tauri::command]
pub fn rebase_next(path: String) -> R<git::RebaseStatus> {
    Ok(git::rebase::next_step(&path)?)
}

#[tauri::command]
pub fn rebase_continue(path: String) -> R<git::RebaseStatus> {
    Ok(git::rebase::cont(&path)?)
}

#[tauri::command]
pub fn rebase_abort(path: String) -> R<git::RebaseStatus> {
    Ok(git::rebase::abort(&path)?)
}

#[tauri::command]
pub fn rebase_status(path: String) -> R<git::RebaseStatus> {
    Ok(git::rebase::status(&path)?)
}

// ---------- Worktrees ----------

#[tauri::command]
pub fn worktree_list(path: String) -> R<Vec<git::WorktreeInfo>> {
    Ok(git::worktree::list(&path)?)
}

#[tauri::command]
pub fn worktree_add(
    path: String,
    name: String,
    target_path: String,
    branch: Option<String>,
) -> R<git::WorktreeInfo> {
    Ok(git::worktree::add(
        &path,
        &name,
        &target_path,
        branch.as_deref(),
    )?)
}

#[tauri::command]
pub fn worktree_remove(path: String, name: String, force: bool) -> R<()> {
    git::worktree::remove(&path, &name, force)?;
    Ok(())
}

#[tauri::command]
pub fn worktree_prune(path: String) -> R<Vec<String>> {
    Ok(git::worktree::prune(&path)?)
}

// ---------- .gitignore editor ----------

#[tauri::command]
pub fn gitignore_read(path: String) -> R<String> {
    Ok(git::gitignore::read(&path)?)
}

#[tauri::command]
pub fn gitignore_write(path: String, contents: String) -> R<()> {
    git::gitignore::write(&path, &contents)?;
    Ok(())
}

#[tauri::command]
pub fn gitignore_preview(path: String, candidate: String) -> R<git::IgnorePreview> {
    Ok(git::gitignore::preview(&path, &candidate)?)
}

#[tauri::command]
pub fn gitignore_templates() -> R<Vec<git::GitignoreTemplate>> {
    Ok(git::gitignore::templates())
}

// ---------- Cross-history search ----------

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn search_commits(
    path: String,
    pattern: String,
    mode: git::SearchMode,
    pattern_kind: git::PatternKind,
    case_sensitive: bool,
    pathspec: Option<String>,
    max_commits: Option<usize>,
    max_hits: Option<usize>,
) -> R<git::SearchSummary> {
    Ok(git::search::search_commits(
        &path,
        &pattern,
        mode,
        pattern_kind,
        case_sensitive,
        pathspec.as_deref(),
        max_commits,
        max_hits,
    )?)
}

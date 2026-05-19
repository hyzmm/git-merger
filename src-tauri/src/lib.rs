mod commands;
mod git;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_repo,
            commands::git_log,
            commands::commit_files,
            commands::file_diff,
            commands::working_diff,
            commands::conflicts,
            commands::merge_state,
            commands::conflict_content,
            commands::resolve_conflict,
            commands::abort_merge,
            commands::commit_merge,
            commands::list_refs,
            commands::blame_file,
            commands::working_changes,
            commands::stage_files,
            commands::unstage_files,
            commands::discard_files,
            commands::commit_changes,
            commands::git_fetch,
            commands::git_pull,
            commands::git_push,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

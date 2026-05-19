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
            commands::list_refs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

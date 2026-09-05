mod commands;
pub mod error;
pub mod git;

use tauri::Emitter;
use tauri::Manager;
use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder, PredefinedMenuItem};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Settings… menu item with platform-standard accelerator (Cmd+, / Ctrl+,)
            let settings = MenuItemBuilder::with_id("settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            // App menu — the first submenu becomes the macOS application menu.
            // Predefined items degrade gracefully on unsupported platforms.
            let app_menu = SubmenuBuilder::new(app, "Git Tools")
                .item(&PredefinedMenuItem::about(app, Some("About Git Tools"), None)?)
                .separator()
                .item(&settings)
                .separator()
                .item(&PredefinedMenuItem::services(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::hide(app, None)?)
                .item(&PredefinedMenuItem::hide_others(app, None)?)
                .item(&PredefinedMenuItem::show_all(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::quit(app, None)?)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .build()?;

            app.set_menu(menu)?;

            // Forward menu clicks to the frontend via Tauri event.
            app.on_menu_event(|app_handle, event| {
                if event.id() == "settings" {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.emit("menu-open-settings", "");
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_repo,
            commands::tracked_files,
            commands::file_history,
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
            commands::list_tags,
            commands::blame_file,
            commands::blame_at_revision,
            commands::previous_filename,
            commands::working_changes,
            commands::stage_files,
            commands::unstage_files,
            commands::discard_files,
            commands::commit_changes,
            commands::head_commit_message,
            commands::read_working_file,
            commands::read_head_file,
            commands::write_working_file,
            commands::format_commit_file_patch,
            commands::format_working_file_patch,
            commands::apply_patch_check,
            commands::apply_patch,
            commands::read_blob_at_commit,
            commands::read_working_blob,
            commands::git_fetch,
            commands::git_pull,
            commands::git_push,
            commands::git_push_tag,
            commands::git_push_all_tags,
            commands::git_delete_remote_tag,
            commands::submit_credentials,
            commands::cancel_credentials,
            commands::cancel_remote_op,
            commands::stash_list,
            commands::stash_save,
            commands::stash_apply,
            commands::stash_pop,
            commands::stash_drop,
            commands::create_branch,
            commands::checkout_branch,
            commands::checkout_commit,
            commands::delete_branch,
            commands::rename_branch,
            commands::create_tag,
            commands::delete_tag,
            commands::cherry_pick,
            commands::cherry_pick_sequence,
            commands::revert_commit,
            commands::reset_to,
            commands::reflog_list,
            commands::submodule_list,
            commands::submodule_init,
            commands::submodule_update,
            commands::submodule_update_recursive,
            commands::submodule_sync,
            commands::config_get,
            commands::config_set,
            commands::rebase_plan,
            commands::rebase_start,
            commands::rebase_next,
            commands::rebase_continue,
            commands::rebase_abort,
            commands::rebase_status,
            commands::worktree_list,
            commands::worktree_add,
            commands::worktree_remove,
            commands::worktree_prune,
            commands::gitignore_read,
            commands::gitignore_write,
            commands::gitignore_preview,
            commands::gitignore_templates,
            commands::git_log_page,
            commands::git_log_since,
            commands::commit_meta,
            commands::commit_ancestors,
            commands::commit_descendants,
            commands::commit_signature_status,
            commands::verify_commit_signature,
            commands::search_commits,
            commands::git_stats_overview,
            commands::git_stats_branches,
            commands::git_stats_churn,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

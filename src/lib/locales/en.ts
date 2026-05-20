/**
 * English locale — the source of truth. The `Dict` type is derived from this
 * object so all other locales must provide the same keys.
 */
export const en = {
  // Sidebar
  "sidebar.history": "History",
  "sidebar.changes": "Changes (working tree)",
  "sidebar.stash": "Stash",
  "sidebar.reflog": "Reflog (HEAD history)",
  "sidebar.submodules": "Submodules",
  "sidebar.diff": "Diff",
  "sidebar.merge": "Merge",

  // Topbar
  "topbar.openRepo": "Open Repository",
  "topbar.refresh": "Refresh (F5)",
  "topbar.fetch": "git fetch --all --prune",
  "topbar.pull": "git pull --ff-only",
  "topbar.push": "git push",
  "topbar.settings": "Settings",
  "topbar.detached": "detached",
  "topbar.loading": "Loading...",

  // Welcome
  "welcome.title": "Git Tools",
  "welcome.subtitle": "IDEA-style History / Diff / Merge for any local Git repository.",
  "welcome.openButton": "Open Repository",
  "welcome.recent": "Recent",
  "welcome.noRecent": "No recent repositories yet.",

  // Settings dialog
  "settings.title": "Settings",
  "settings.appearance": "Appearance",
  "settings.theme": "Theme",
  "settings.theme.auto": "Auto",
  "settings.theme.light": "Light",
  "settings.theme.dark": "Dark",
  "settings.fontSize": "Font size",
  "settings.tabWidth": "Tab width",
  "settings.language": "Language",
  "settings.language.en": "English",
  "settings.language.zh": "中文",
  "settings.resetAppearance": "Reset appearance to defaults",
  "settings.gitConfig": "Git config",
  "settings.gitConfig.subtitle":
    "Affects how this repo (or your global ~/.gitconfig) handles line endings.",
  "settings.gitConfig.openFirst": "Open a repository first to inspect or edit git config.",
  "settings.gitConfig.scope": "Scope",
  "settings.gitConfig.scope.local": "This repo",
  "settings.gitConfig.scope.global": "Global (~/.gitconfig)",
  "settings.gitConfig.save": "Save",
  "settings.gitConfig.saving": "Saving...",
  "settings.close": "Close",

  // Common buttons / actions
  "common.cancel": "Cancel",
  "common.confirm": "OK",
  "common.delete": "Delete",
  "common.rename": "Rename",
  "common.checkout": "Checkout",
  "common.copy": "Copy",
  "common.apply": "Apply",
  "common.reset": "Reset",
  "common.loading": "loading...",
  "common.working": "working...",
  "common.dismiss": "Dismiss",
  "common.back": "Back",

  // Updater
  "updater.available": "Update v{version}",
  "updater.downloading": "Downloading {pct}%",
  "updater.ready": "Restart to update",
  "updater.title": "New version available",
  "updater.later": "Later",
  "updater.download": "Download & install",
  "updater.restart": "Restart now",
} as const;

export type Dict = Record<keyof typeof en, string>;

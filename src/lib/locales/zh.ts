import type { Dict } from "./en";

export const zh: Dict = {
  // Sidebar
  "sidebar.history": "历史",
  "sidebar.changes": "工作区变更",
  "sidebar.stash": "Stash",
  "sidebar.reflog": "Reflog（HEAD 历史）",
  "sidebar.submodules": "子模块",
  "sidebar.diff": "Diff",
  "sidebar.merge": "合并",

  // Topbar
  "topbar.openRepo": "打开仓库",
  "topbar.refresh": "刷新 (F5)",
  "topbar.fetch": "git fetch --all --prune",
  "topbar.pull": "git pull --ff-only",
  "topbar.push": "git push",
  "topbar.settings": "设置",
  "topbar.detached": "游离 HEAD",
  "topbar.loading": "加载中...",

  // Welcome
  "welcome.title": "Git Tools",
  "welcome.subtitle": "IDEA 风格的本地 Git 仓库 History / Diff / Merge 工具。",
  "welcome.openButton": "打开仓库",
  "welcome.recent": "最近打开",
  "welcome.noRecent": "暂无最近打开的仓库。",

  // Settings dialog
  "settings.title": "设置",
  "settings.appearance": "外观",
  "settings.theme": "主题",
  "settings.theme.auto": "跟随系统",
  "settings.theme.light": "浅色",
  "settings.theme.dark": "深色",
  "settings.fontSize": "字号",
  "settings.tabWidth": "Tab 宽度",
  "settings.language": "语言",
  "settings.language.en": "English",
  "settings.language.zh": "中文",
  "settings.resetAppearance": "外观恢复默认",
  "settings.gitConfig": "Git 配置",
  "settings.gitConfig.subtitle": "影响当前仓库（或全局 ~/.gitconfig）如何处理行尾。",
  "settings.gitConfig.openFirst": "请先打开仓库才能查看或编辑 git 配置。",
  "settings.gitConfig.scope": "作用域",
  "settings.gitConfig.scope.local": "当前仓库",
  "settings.gitConfig.scope.global": "全局 (~/.gitconfig)",
  "settings.gitConfig.save": "保存",
  "settings.gitConfig.saving": "保存中...",
  "settings.close": "关闭",

  // Common
  "common.cancel": "取消",
  "common.confirm": "确认",
  "common.delete": "删除",
  "common.rename": "重命名",
  "common.checkout": "切换",
  "common.copy": "复制",
  "common.apply": "应用",
  "common.reset": "重置",
  "common.loading": "加载中...",
  "common.working": "处理中...",
  "common.dismiss": "关闭",
  "common.back": "返回",

  // Updater
  "updater.available": "更新到 v{version}",
  "updater.downloading": "下载中 {pct}%",
  "updater.ready": "重启以完成更新",
  "updater.title": "发现新版本",
  "updater.later": "稍后",
  "updater.download": "下载并安装",
  "updater.restart": "立即重启",
};

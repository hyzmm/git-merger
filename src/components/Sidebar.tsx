import {
  History,
  GitCompare,
  GitMerge,
  FilePlus2,
  Archive,
  Undo2,
  Box,
  ListOrdered,
  Trees,
  FileX,
  Search,
  Tag,
  BarChart3,
  Settings,
} from "lucide-react";
import { useApp, type ViewKey } from "@/stores/app";
import { useT, type TKey } from "@/lib/i18n";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import { SettingsDialog } from "@/components/SettingsDialog";

const items: { key: ViewKey; labelKey: TKey; Icon: typeof History }[] = [
  { key: "history", labelKey: "sidebar.history", Icon: History },
  { key: "changes", labelKey: "sidebar.changes", Icon: FilePlus2 },
  { key: "stash", labelKey: "sidebar.stash", Icon: Archive },
  { key: "reflog", labelKey: "sidebar.reflog", Icon: Undo2 },
  { key: "submodules", labelKey: "sidebar.submodules", Icon: Box },
  { key: "rebase", labelKey: "sidebar.rebase", Icon: ListOrdered },
  { key: "worktrees", labelKey: "sidebar.worktrees", Icon: Trees },
  { key: "gitignore", labelKey: "sidebar.gitignore", Icon: FileX },
  { key: "search", labelKey: "sidebar.search", Icon: Search },
  { key: "tags", labelKey: "sidebar.tags", Icon: Tag },
  { key: "diff", labelKey: "sidebar.diff", Icon: GitCompare },
  { key: "merge", labelKey: "sidebar.merge", Icon: GitMerge },
  { key: "stats", labelKey: "sidebar.stats", Icon: BarChart3 },
];

export function Sidebar() {
  const { view, setView, repo } = useApp();
  const t = useT();

  return (
    <SidebarRoot collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {items.map(({ key, labelKey, Icon }) => {
                const active = view === key;
                return (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuButton
                      tooltip={t(labelKey)}
                      isActive={active}
                      disabled={!repo}
                      onClick={() => setView(key)}
                    >
                      <Icon />
                      <span>{t(labelKey)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SettingsDialog>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Settings />
                    <span>{t("sidebar.settings")}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SettingsDialog>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
      <SidebarFooter className="h-6"></SidebarFooter>
    </SidebarRoot>
  );
}

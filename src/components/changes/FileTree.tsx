/**
 * FileTree — directory-tree view of working-tree changes.
 *
 * Mirrors IDEA's Commit tool window file list: files grouped by directory,
 * expandable/collapsible folders, per-file checkboxes, colour-coded status
 * letters (A/M/D/?), a summary bar at the top, and directory-level
 * tri-state checkboxes for bulk select/deselect.
 */
import { useMemo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { WorkingFile } from '@/ipc/git';
import { ChevronRight, ChevronDown, ChevronsUpDown, ChevronsDownUp, Search, X } from 'lucide-react';
import { Item, ItemGroup, ItemContent, ItemTitle, ItemMedia } from '@/components/ui/item';

const STATUS_LABEL: Record<WorkingFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  typechange: 'T',
  untracked: '?',
  conflict: '!',
};

const STATUS_COLOR: Record<WorkingFile['status'], string> = {
  added: 'text-[hsl(var(--diff-added-fg))]',
  modified: 'text-[hsl(var(--diff-modified-fg))]',
  deleted: 'text-[hsl(var(--diff-removed-fg))]',
  renamed: 'text-[hsl(var(--branch-2))]',
  typechange: 'text-[hsl(var(--branch-3))]',
  untracked: 'text-muted-foreground',
  conflict: 'text-[hsl(var(--destructive))]',
};

export interface FileTreeProps {
  files: WorkingFile[];
  selected: Set<string>;
  expandedDirs: Set<string>;
  fileFilter: string;
  onToggle: (path: string) => void;
  onToggleDir: (dir: string) => void;
  /** Toggle all files under a directory (select/deselect all). */
  onToggleDirFiles: (dir: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onFilterChange: (q: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  /** Click on filename text — preview diff inline. */
  onClickFile: (path: string) => void;
  /** Double-click on filename — open full Diff view. */
  onDoubleClickFile: (path: string) => void;
  /** Right-click context menu callback. */
  onContextMenu: (path: string, e: React.MouseEvent) => void;
}

interface TreeNode {
  kind: 'dir' | 'file';
  name: string;
  /** Full path from repo root. For dirs this is the directory path prefix. */
  path: string;
  children?: TreeNode[];
  file?: WorkingFile;
}

function buildTree(files: WorkingFile[]): TreeNode[] {
  const dirRefs = new Map<string, TreeNode>();
  const result: TreeNode[] = [];

  // First pass: register all directories
  for (const f of files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/');
      if (!dirRefs.has(dirPath)) {
        dirRefs.set(dirPath, {
          kind: 'dir',
          name: parts[i - 1],
          path: dirPath,
          children: [],
        });
      }
    }
  }

  // Second pass: insert files into their parent directory
  for (const f of files) {
    const parts = f.path.split('/');
    const fileNode: TreeNode = {
      kind: 'file',
      name: parts[parts.length - 1],
      path: f.path,
      file: f,
    };

    if (parts.length === 1) {
      result.push(fileNode);
    } else {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = dirRefs.get(parentPath);
      if (parent?.children) {
        parent.children.push(fileNode);
      } else {
        result.push(fileNode);
      }
    }

    // Ensure intermediate dirs appear in result
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/');
      const dir = dirRefs.get(dirPath);
      if (!dir) continue;
      if (i === 1) {
        if (!result.some((n) => n.path === dirPath)) {
          result.push(dir);
        }
      } else {
        const parentPath = parts.slice(0, i - 1).join('/');
        const parent = dirRefs.get(parentPath);
        if (parent?.children && !parent.children.some((c) => c.path === dirPath)) {
          parent.children.push(dir);
        }
      }
    }
  }

  // Sort: dirs first, then files, alphabetically
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children) sortNodes(n.children);
    }
  };
  sortNodes(result);

  return result;
}

export function FileTree({
  files,
  selected,
  expandedDirs,
  fileFilter,
  onToggle,
  onToggleDir,
  onToggleDirFiles,
  onExpandAll,
  onCollapseAll,
  onFilterChange,
  onSelectAll,
  onClearSelection,
  onClickFile,
  onDoubleClickFile,
  onContextMenu,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);

  const staged = files.filter((f) => f.flag === 'staged' || f.flag === 'both');
  const unstaged = files.filter(
    (f) => f.flag === 'unstaged' || f.flag === 'untracked' || f.flag === 'both',
  );
  const conflicts = files.filter((f) => f.flag === 'conflict');

  const q = fileFilter.toLowerCase();
  const filteredTree = useMemo(() => {
    if (!q) return tree;
    return filterTree(tree, q);
  }, [tree, q]);

  const hasSelection = selected.size > 0;
  const allDirsExpanded = useMemo(() => {
    const allDirs = getAllDirs(tree);
    return allDirs.length > 0 && allDirs.every((d) => expandedDirs.has(d));
  }, [tree, expandedDirs]);

  return (
    <div className="flex h-full flex-col">
      {/* Summary bar */}
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border bg-card px-2 text-sm">
        <span className="font-medium text-foreground">{files.length} files</span>
        {staged.length > 0 && <span className="text-diff-added-fg">{staged.length} staged</span>}
        {unstaged.length > 0 && (
          <span className="text-muted-foreground">{unstaged.length} unstaged</span>
        )}
        {conflicts.length > 0 && (
          <span className="text-destructive">{conflicts.length} conflicts</span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onExpandAll}
            disabled={allDirsExpanded || tree.length === 0}
            title="Expand all"
          >
            <ChevronsUpDown className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onCollapseAll}
            disabled={expandedDirs.size === 0}
            title="Collapse all"
          >
            <ChevronsDownUp className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Quick actions bar */}
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border/50 px-2 text-[10.5px]">
        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-sm" onClick={onSelectAll}>
          Select all
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-sm"
          onClick={onClearSelection}
          disabled={!hasSelection}
        >
          Clear
        </Button>
        <span className="ml-auto text-muted-foreground">
          {hasSelection ? `${selected.size} selected` : ''}
        </span>
      </div>

      {/* Search bar */}
      <div className="relative shrink-0 border-b border-border/50 px-1.5 py-1">
        <Search className="absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={fileFilter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter files…"
          className="h-6 border-0 bg-transparent pl-6 pr-6 text-sm shadow-none outline-none focus-visible:ring-0"
        />
        {fileFilter && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2"
            onClick={() => onFilterChange('')}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* File tree */}
      <ItemGroup className="min-h-0 flex-1 overflow-auto gap-0 has-data-[size=xs]:gap-0">
        {filteredTree.length === 0 && files.length > 0 && (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No files match &ldquo;{fileFilter}&rdquo;
          </div>
        )}
        {files.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Working tree is clean.
          </div>
        )}
        {filteredTree.map((node) => (
          <TreeNodeRow
            key={node.path}
            node={node}
            depth={0}
            selected={selected}
            expandedDirs={expandedDirs}
            onToggle={onToggle}
            onToggleDir={onToggleDir}
            onToggleDirFiles={onToggleDirFiles}
            onClickFile={onClickFile}
            onDoubleClickFile={onDoubleClickFile}
            onContextMenu={onContextMenu}
          />
        ))}
      </ItemGroup>
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  selected,
  expandedDirs,
  onToggle,
  onToggleDir,
  onToggleDirFiles,
  onClickFile,
  onDoubleClickFile,
  onContextMenu,
}: {
  node: TreeNode;
  depth: number;
  selected: Set<string>;
  expandedDirs: Set<string>;
  onToggle: (path: string) => void;
  onToggleDir: (dir: string) => void;
  onToggleDirFiles: (dir: string) => void;
  onClickFile: (path: string) => void;
  onDoubleClickFile: (path: string) => void;
  onContextMenu: (path: string, e: React.MouseEvent) => void;
}) {
  if (node.kind === 'dir') {
    const expanded = expandedDirs.has(node.path);
    const childCount = countFiles(node);
    // Compute directory checkbox state.
    const childFiles = collectFilePaths(node);
    const selectedCount = childFiles.filter((p) => selected.has(p)).length;
    const dirChecked: boolean | 'indeterminate' =
      childFiles.length === 0
        ? false
        : selectedCount === childFiles.length
          ? true
          : selectedCount > 0
            ? 'indeterminate'
            : false;
    return (
      <>
        <Item
          size="xs"
          variant="default"
          className="border-0 border-b border-border/20 gap-1 px-1 py-0.5 rounded-none hover:bg-accent/40"
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onToggleDir(node.path);
          }}
        >
          {/* chevron — expand/collapse */}
          <ItemMedia
            variant="icon"
            className="relative z-10 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onToggleDir(node.path);
            }}
          >
            {expanded ? (
              <ChevronDown className="size-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3 text-muted-foreground" />
            )}
          </ItemMedia>
          {/* dir checkbox — select/deselect all files under this directory */}
          <Checkbox
            checked={dirChecked === true}
            indeterminate={dirChecked === 'indeterminate'}
            onCheckedChange={() => onToggleDirFiles(node.path)}
            className="size-3.5 shrink-0"
            aria-label={`Select all in ${node.path}`}
          />
          {/* directory name — click to expand/collapse */}
          <ItemContent className="gap-0">
            <ItemTitle
              className="text-sm font-medium cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onToggleDir(node.path);
              }}
            >
              {node.name}
            </ItemTitle>
          </ItemContent>
          {/* file count — click to expand/collapse */}
          <span
            className="shrink-0 cursor-pointer text-[10px] tabular-nums text-muted-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onToggleDir(node.path);
            }}
          >
            {childCount}
          </span>
        </Item>
        {expanded &&
          node.children?.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              expandedDirs={expandedDirs}
              onToggle={onToggle}
              onToggleDir={onToggleDir}
              onToggleDirFiles={onToggleDirFiles}
              onClickFile={onClickFile}
              onDoubleClickFile={onDoubleClickFile}
              onContextMenu={onContextMenu}
            />
          ))}
      </>
    );
  }

  // File node
  const isSelected = selected.has(node.path);
  const f = node.file!;
  return (
    <Item
      size="xs"
      variant="default"
      className={cn(
        'border-0 border-b border-border/20 gap-1 px-1 py-0.5 rounded-none cursor-pointer hover:bg-accent/40',
        isSelected && 'bg-accent/60',
      )}
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
      onClick={() => onClickFile(node.path)}
      onDoubleClick={() => onDoubleClickFile(node.path)}
      onContextMenu={(e) => onContextMenu(node.path, e)}
    >
      {/* Spacer to align checkbox with directory checkboxes (same width as chevron icon) */}
      <span className="w-3 shrink-0" />
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onToggle(node.path)}
        className="size-3.5 shrink-0"
        aria-label={`Select ${node.path}`}
        onClick={(e) => e.stopPropagation()}
      />
      <span
        className={cn(
          'w-3.5 shrink-0 text-center font-mono text-sm font-bold',
          STATUS_COLOR[f.status],
        )}
      >
        {STATUS_LABEL[f.status]}
      </span>
      <ItemContent className="gap-0">
        <ItemTitle className="text-sm font-mono font-normal">{node.name}</ItemTitle>
      </ItemContent>
      {f.flag !== 'unstaged' && f.flag !== 'untracked' && (
        <span
          className={cn(
            'shrink-0 rounded px-1 py-px text-[9px] font-medium',
            f.flag === 'staged'
              ? 'bg-[hsl(var(--diff-added-bg))]/30 text-diff-added-fg'
              : f.flag === 'both'
                ? 'bg-[hsl(var(--branch-2))]/20 text-[hsl(var(--branch-2))]'
                : 'bg-[hsl(var(--destructive))]/20 text-destructive',
          )}
        >
          {f.flag === 'staged' ? 'staged' : f.flag}
        </span>
      )}
    </Item>
  );
}

/** Filter tree nodes recursively, keeping dirs that have matching children. */
function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'file') {
      if (node.name.toLowerCase().includes(q)) {
        result.push(node);
      }
    } else {
      const filtered = node.children ? filterTree(node.children, q) : [];
      if (filtered.length > 0) {
        result.push({ ...node, children: filtered });
      }
    }
  }
  return result;
}

/** Count total descendant files under a node. */
function countFiles(node: TreeNode): number {
  if (node.kind === 'file') return 1;
  let c = 0;
  if (node.children) {
    for (const child of node.children) c += countFiles(child);
  }
  return c;
}

/** Collect all directory paths in the tree. */
function getAllDirs(nodes: TreeNode[]): string[] {
  const dirs: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'dir') {
      dirs.push(node.path);
      if (node.children) dirs.push(...getAllDirs(node.children));
    }
  }
  return dirs;
}

/** Collect all descendant file paths under a tree node. */
function collectFilePaths(node: TreeNode): string[] {
  if (node.kind === 'file') return [node.path];
  const paths: string[] = [];
  if (node.children) {
    for (const child of node.children) {
      paths.push(...collectFilePaths(child));
    }
  }
  return paths;
}

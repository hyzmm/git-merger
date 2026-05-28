import { FileTree } from "@/components/diff/FileTree";
import { DiffViewer } from "@/components/diff/DiffViewer";

export function DiffPage() {
  return (
    <div className="grid h-full grid-cols-[280px_1fr]">
      <div className="min-h-0 border-r border-border overflow-y-auto h-full">
        <FileTree />
      </div>
      <div className="min-w-0 overflow-y-auto h-full">
        <DiffViewer />
      </div>
    </div>
  );
}

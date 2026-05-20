import { RefsPane } from "@/components/history/RefsPane";
import { CommitList } from "@/components/history/CommitList";
import { CommitDetails } from "@/components/history/CommitDetails";

export function HistoryPage() {
  return (
    <div className="grid h-full grid-cols-[220px_1fr_380px]">
      <div className="min-h-0 min-w-0 overflow-hidden border-r border-border">
        <RefsPane />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden">
        <CommitList />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden">
        <CommitDetails />
      </div>
    </div>
  );
}

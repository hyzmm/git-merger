import { RefsPane } from "@/components/history/RefsPane";
import { CommitList } from "@/components/history/CommitList";
import { CommitDetails } from "@/components/history/CommitDetails";

export function HistoryPage() {
  return (
    <div className="grid h-full grid-cols-[220px_1fr_380px]">
      <div className="min-h-0 border-r border-border">
        <RefsPane />
      </div>
      <div className="min-w-0">
        <CommitList />
      </div>
      <div className="min-w-0">
        <CommitDetails />
      </div>
    </div>
  );
}

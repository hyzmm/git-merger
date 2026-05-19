export function MergePage() {
  return (
    <div className="grid h-full grid-cols-3">
      <section className="min-w-0 overflow-auto border-r border-border p-4 text-sm text-muted-foreground">
        LEFT (ours)
      </section>
      <section className="min-w-0 overflow-auto border-r border-border p-4 text-sm text-muted-foreground">
        RESULT
      </section>
      <section className="min-w-0 overflow-auto p-4 text-sm text-muted-foreground">
        RIGHT (theirs)
      </section>
    </div>
  );
}

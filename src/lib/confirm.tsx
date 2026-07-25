/**
 * Command-style confirmation dialog (v0.14).
 *
 * Like antd `Modal.confirm()` / MUI `showConfirmDialog()` — each call
 * dynamically creates a React root, renders a shadcn AlertDialog, and
 * resolves the returned Promise when the user clicks a button or
 * dismisses (ESC / backdrop).
 *
 * No store state, no top-level component, no `open` variable to
 * maintain — zero overhead when idle.
 *
 * Usage: `import { confirm } from "@/lib/confirm";`
 */
import { createRoot } from "react-dom/client";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ConfirmRequest {
  /** Severity tone: red destructive vs neutral primary button. */
  level: "danger" | "warning";
  /** Short headline ("Discard 5 file(s)?"). */
  title: string;
  /** One-line subtitle / consequence summary. */
  message: string;
  /**
   * Optional verbatim block (refspecs, oid, file list…) shown in a
   * monospace card under the message.
   */
  detail?: string;
  /** Confirm-button label; defaults to "Delete" / "OK" by level. */
  confirmLabel?: string;
  /** Cancel-button label; defaults to "Cancel". */
  cancelLabel?: string;
}

export function confirm(opts: ConfirmRequest): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const done = (ok: boolean) => {
      // Brief delay so the close animation has time to play before
      // React unmounts the tree and removes the DOM node.
      setTimeout(() => {
        root.unmount();
        container.remove();
      }, 200);
      resolve(ok);
    };

    const isDanger = opts.level === "danger";
    const Icon = isDanger ? ShieldAlert : AlertTriangle;
    const iconCls = isDanger
      ? "text-[hsl(var(--destructive))]"
      : "text-[hsl(var(--branch-3))]";
    const defaultLabel = isDanger ? t("common.delete") : t("common.confirm");

    root.render(
      <AlertDialog
        defaultOpen
        onOpenChange={(open) => {
          // ESC key or backdrop click → cancel
          if (!open) done(false);
        }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-2">
              <Icon className={cn("h-4 w-4 shrink-0", iconCls)} />
              <AlertDialogTitle>{opts.title}</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {opts.message}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {opts.detail && (
            <pre className="max-h-40 overflow-auto rounded border border-border bg-secondary px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap break-all">
              {opts.detail}
            </pre>
          )}

          <AlertDialogFooter>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => done(false)}
            >
              {opts.cancelLabel ?? t("common.cancel")}
            </Button>
            <Button
              variant={isDanger ? "destructive" : "default"}
              size="sm"
              type="button"
              onClick={() => done(true)}
            >
              {opts.confirmLabel ?? defaultLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
  });
}

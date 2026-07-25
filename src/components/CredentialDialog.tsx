/**
 * Listens for `git://credentials-needed` events from Rust and prompts the
 * user for a username/password. The reply is delivered back via the
 * `submit_credentials` (or `cancel_credentials`) command, which unblocks
 * libgit2's credential callback waiting on the other side.
 *
 * v0.14 — Migrated to shadcn Dialog.
 */
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { KeyRound } from "lucide-react";
import { git, type CredRequest } from "@/ipc/git";
import { useT } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function CredentialDialog() {
  const [req, setReq] = useState<CredRequest | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const t = useT();

  useEffect(() => {
    const un = listen<CredRequest>("git://credentials-needed", (ev) => {
      setReq(ev.payload);
      setUsername(ev.payload.username_hint ?? "");
      setPassword("");
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  async function submit() {
    if (!req || busy) return;
    setBusy(true);
    try {
      await git.submitCredentials(req.id, username, password);
    } finally {
      setBusy(false);
      setReq(null);
      setPassword("");
    }
  }

  async function cancel() {
    if (!req) return;
    setBusy(true);
    try {
      await git.cancelCredentials(req.id);
    } finally {
      setBusy(false);
      setReq(null);
      setPassword("");
    }
  }

  return (
    <Dialog
      open={!!req}
      onOpenChange={(open) => {
        if (!open) void cancel();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            void cancel();
          }
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <DialogTitle>{t("creds.title")}</DialogTitle>
          </div>
          <DialogDescription>{t("creds.subtitle")}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-3"
        >
          <div className="rounded border border-border bg-secondary px-2 py-1.5 font-mono text-[11px] break-all">
            {req?.url}
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              {t("creds.username")}
            </span>
            <Input
              autoFocus={!username}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              {t("creds.password")}
            </span>
            <Input
              autoFocus={!!username}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full"
            />
            <span className="mt-1 block text-[10.5px] text-muted-foreground">
              {t("creds.tokenHint")}
            </span>
          </label>

          <DialogFooter showCloseButton={false}>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => void cancel()}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              type="submit"
              disabled={busy || !username || !password}
            >
              {busy ? t("creds.signingIn") : t("creds.signIn")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

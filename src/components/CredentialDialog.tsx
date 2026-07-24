/**
 * Listens for `git://credentials-needed` events from Rust and prompts the
 * user for a username/password. The reply is delivered back via the
 * `submit_credentials` (or `cancel_credentials`) command, which unblocks
 * libgit2's credential callback waiting on the other side.
 */
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { KeyRound, X } from "lucide-react";
import { git, type CredRequest } from "@/ipc/git";
import { useT } from "@/lib/i18n";

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

  if (!req) return null;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative w-full max-w-md rounded-lg border border-border bg-card text-card-foreground shadow-xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{t("creds.title")}</h2>
          </div>
          <button
            onClick={cancel}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-3 px-4 py-3"
        >
          <p className="text-xs text-muted-foreground">{t("creds.subtitle")}</p>
          <div className="rounded border border-border bg-secondary px-2 py-1.5 font-mono text-[11px] break-all">
            {req.url}
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

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="rounded border border-border bg-secondary px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy || !username || !password}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? t("creds.signingIn") : t("creds.signIn")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

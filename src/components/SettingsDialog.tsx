import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useApp } from "@/stores/app";
import { useSettings, type GraphMode, type ThemeMode } from "@/stores/settings";
import { useI18n, useT, type Locale } from "@/lib/i18n";
import { git } from "@/ipc/git";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

const FONT_SIZES = [12, 13, 14, 15, 16, 18];
const TAB_SIZES = [2, 4, 8];
const AUTOCRLF_VALUES = [
  { v: "", label: "(unset / inherit)" },
  { v: "false", label: "false — keep line endings as-is" },
  { v: "input", label: "input — convert CRLF→LF on commit (recommended on macOS/Linux)" },
  { v: "true", label: "true — convert CRLF↔LF (recommended on Windows)" },
];

export function SettingsDialog({ open, onClose }: Props) {
  const repo = useApp((s) => s.repo);
  const theme = useSettings((s) => s.theme);
  const fontSize = useSettings((s) => s.fontSize);
  const tabSize = useSettings((s) => s.tabSize);
  const graphMode = useSettings((s) => s.graphMode);
  const setSetting = useSettings((s) => s.set);
  const reset = useSettings((s) => s.reset);
  const locale = useI18n((s) => s.locale);
  const setLocale = useI18n((s) => s.setLocale);
  const t = useT();

  const [autocrlf, setAutocrlf] = useState<string>("");
  const [autocrlfScope, setAutocrlfScope] = useState<"local" | "global">("global");
  const [autocrlfBusy, setAutocrlfBusy] = useState(false);
  const [autocrlfStatus, setAutocrlfStatus] = useState<string | null>(null);

  // ---------- Commit signing (v0.13.19) ----------
  // Five linked git config keys: commit.gpgsign / gpg.format / user.signingkey
  // / gpg.program / gpg.ssh.program. We mirror the same scope toggle as
  // core.autocrlf and write all five in a single Save click.
  const [signEnabled, setSignEnabled] = useState(false);
  const [signFormat, setSignFormat] = useState<"openpgp" | "ssh">("openpgp");
  const [signKey, setSignKey] = useState("");
  const [signGpgProgram, setSignGpgProgram] = useState("");
  const [signSshProgram, setSignSshProgram] = useState("");
  const [signScope, setSignScope] = useState<"local" | "global">("global");
  const [signBusy, setSignBusy] = useState(false);
  const [signStatus, setSignStatus] = useState<string | null>(null);

  // Re-load core.autocrlf each time the dialog opens.
  useEffect(() => {
    if (!open || !repo) return;
    let cancelled = false;
    void (async () => {
      try {
        const v = await git.configGet(repo.path, "core.autocrlf");
        if (!cancelled) setAutocrlf(v ?? "");
      } catch (e) {
        if (!cancelled) setAutocrlfStatus(`Failed to read: ${e}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, repo]);

  // Re-load commit-signing config (v0.13.19) on dialog open.
  // We pull the merged view (local overrides global) for each of the five
  // keys; missing keys come back as null and surface as the field default.
  useEffect(() => {
    if (!open || !repo) return;
    let cancelled = false;
    void (async () => {
      try {
        const [gpgsign, fmt, key, gpgp, sshp] = await Promise.all([
          git.configGet(repo.path, "commit.gpgsign"),
          git.configGet(repo.path, "gpg.format"),
          git.configGet(repo.path, "user.signingkey"),
          git.configGet(repo.path, "gpg.program"),
          git.configGet(repo.path, "gpg.ssh.program"),
        ]);
        if (cancelled) return;
        const truthy = (v: string | null) =>
          !!v && ["true", "yes", "on", "1"].includes(v.trim().toLowerCase());
        setSignEnabled(truthy(gpgsign));
        setSignFormat((fmt ?? "").trim().toLowerCase() === "ssh" ? "ssh" : "openpgp");
        setSignKey(key ?? "");
        setSignGpgProgram(gpgp ?? "");
        setSignSshProgram(sshp ?? "");
      } catch (e) {
        if (!cancelled) setSignStatus(`${t("settings.signing.failedRead")}: ${e}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, repo, t]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onSaveAutocrlf = async () => {
    if (!repo) return;
    setAutocrlfBusy(true);
    setAutocrlfStatus(null);
    try {
      await git.configSet(repo.path, "core.autocrlf", autocrlf, autocrlfScope);
      setAutocrlfStatus(
        autocrlf === ""
          ? `Removed core.autocrlf from ${autocrlfScope} config.`
          : `Set core.autocrlf=${autocrlf} in ${autocrlfScope} config.`,
      );
    } catch (e) {
      setAutocrlfStatus(`Failed: ${e}`);
    } finally {
      setAutocrlfBusy(false);
    }
  };

  // Save all five commit-signing keys atomically (well, sequentially — git
  // config is a flat ini file, no transaction). On failure we surface the
  // first error and bail; previously-written keys stay set, which is the
  // same semantics `git config` gives anyway.
  const onSaveSigning = async () => {
    if (!repo) return;
    setSignBusy(true);
    setSignStatus(null);
    try {
      await git.configSet(repo.path, "commit.gpgsign", signEnabled ? "true" : "false", signScope);
      // Empty string deletes the key, falling back to git's default.
      await git.configSet(
        repo.path,
        "gpg.format",
        signFormat === "ssh" ? "ssh" : "openpgp",
        signScope,
      );
      await git.configSet(repo.path, "user.signingkey", signKey.trim(), signScope);
      await git.configSet(repo.path, "gpg.program", signGpgProgram.trim(), signScope);
      await git.configSet(repo.path, "gpg.ssh.program", signSshProgram.trim(), signScope);
      setSignStatus(
        signEnabled
          ? t("settings.signing.savedEnabled").replace("{scope}", signScope)
          : t("settings.signing.savedDisabled").replace("{scope}", signScope),
      );
    } catch (e) {
      setSignStatus(`${t("settings.signing.failedSave")}: ${e}`);
    } finally {
      setSignBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        className="max-h-[88vh] w-[560px] max-w-[92vw] overflow-auto rounded-lg border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">{t("settings.title")}</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("settings.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-4">
          <Section title={t("settings.appearance")}>
            <Row label={t("settings.theme")}>
              <SegGroup<ThemeMode>
                value={theme}
                options={[
                  { v: "auto", label: t("settings.theme.auto") },
                  { v: "light", label: t("settings.theme.light") },
                  { v: "dark", label: t("settings.theme.dark") },
                ]}
                onChange={(v) => setSetting({ theme: v })}
              />
            </Row>

            <Row label={t("settings.fontSize")}>
              <SegGroup<number>
                value={fontSize}
                options={FONT_SIZES.map((n) => ({ v: n, label: `${n}px` }))}
                onChange={(v) => setSetting({ fontSize: v })}
              />
            </Row>

            <Row label={t("settings.tabWidth")}>
              <SegGroup<number>
                value={tabSize}
                options={TAB_SIZES.map((n) => ({ v: n, label: String(n) }))}
                onChange={(v) => setSetting({ tabSize: v })}
              />
            </Row>

            <Row label={t("settings.language")}>
              <SegGroup<Locale>
                value={locale}
                options={[
                  { v: "en", label: t("settings.language.en") },
                  { v: "zh", label: t("settings.language.zh") },
                ]}
                onChange={setLocale}
              />
            </Row>

            <Row label={t("settings.graphMode")}>
              <SegGroup<GraphMode>
                value={graphMode}
                options={[
                  { v: "normal", label: t("settings.graphMode.normal") },
                  { v: "compact", label: t("settings.graphMode.compact") },
                  { v: "hidden", label: t("settings.graphMode.hidden") },
                ]}
                onChange={(v) => setSetting({ graphMode: v })}
              />
            </Row>

            <div className="text-right">
              <button
                onClick={reset}
                className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
              >
                {t("settings.resetAppearance")}
              </button>
            </div>
          </Section>

          <Section title={t("settings.gitConfig")} subtitle={t("settings.gitConfig.subtitle")}>
            {!repo ? (
              <p className="text-[11px] text-muted-foreground">
                {t("settings.gitConfig.openFirst")}
              </p>
            ) : (
              <>
                <Row label="core.autocrlf">
                  <select
                    value={autocrlf}
                    onChange={(e) => setAutocrlf(e.target.value)}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
                  >
                    {AUTOCRLF_VALUES.map((o) => (
                      <option key={o.v} value={o.v}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label={t("settings.gitConfig.scope")}>
                  <SegGroup<"local" | "global">
                    value={autocrlfScope}
                    options={[
                      { v: "local", label: t("settings.gitConfig.scope.local") },
                      { v: "global", label: t("settings.gitConfig.scope.global") },
                    ]}
                    onChange={setAutocrlfScope}
                  />
                </Row>
                <div className="flex items-center justify-end gap-2">
                  {autocrlfStatus && (
                    <span
                      className={cn(
                        "mr-auto text-[11px]",
                        autocrlfStatus.startsWith("Failed")
                          ? "text-destructive"
                          : "text-[hsl(var(--branch-1))]",
                      )}
                    >
                      {autocrlfStatus}
                    </span>
                  )}
                  <button
                    onClick={onSaveAutocrlf}
                    disabled={autocrlfBusy}
                    className={cn(
                      "h-7 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:opacity-90",
                      autocrlfBusy && "cursor-not-allowed opacity-60",
                    )}
                  >
                    {autocrlfBusy ? t("settings.gitConfig.saving") : t("settings.gitConfig.save")}
                  </button>
                </div>
              </>
            )}
          </Section>

          <Section title={t("settings.signing")} subtitle={t("settings.signing.subtitle")}>
            {!repo ? (
              <p className="text-[11px] text-muted-foreground">
                {t("settings.gitConfig.openFirst")}
              </p>
            ) : (
              <>
                <Row label={t("settings.signing.enabled")}>
                  <SegGroup<"on" | "off">
                    value={signEnabled ? "on" : "off"}
                    options={[
                      { v: "off", label: t("settings.signing.off") },
                      { v: "on", label: t("settings.signing.on") },
                    ]}
                    onChange={(v) => setSignEnabled(v === "on")}
                  />
                </Row>
                <Row label={t("settings.signing.format")}>
                  <SegGroup<"openpgp" | "ssh">
                    value={signFormat}
                    options={[
                      { v: "openpgp", label: t("settings.signing.format.openpgp") },
                      { v: "ssh", label: t("settings.signing.format.ssh") },
                    ]}
                    onChange={setSignFormat}
                  />
                </Row>
                <Row label={t("settings.signing.signingKey")}>
                  <input
                    type="text"
                    value={signKey}
                    onChange={(e) => setSignKey(e.target.value)}
                    placeholder={
                      signFormat === "ssh"
                        ? t("settings.signing.signingKey.placeholderSsh")
                        : t("settings.signing.signingKey.placeholderGpg")
                    }
                    className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus:border-ring"
                    spellCheck={false}
                  />
                </Row>
                <Row
                  label={
                    signFormat === "ssh"
                      ? t("settings.signing.sshProgram")
                      : t("settings.signing.gpgProgram")
                  }
                >
                  <input
                    type="text"
                    value={signFormat === "ssh" ? signSshProgram : signGpgProgram}
                    onChange={(e) =>
                      signFormat === "ssh"
                        ? setSignSshProgram(e.target.value)
                        : setSignGpgProgram(e.target.value)
                    }
                    placeholder={signFormat === "ssh" ? "ssh-keygen" : "gpg"}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus:border-ring"
                    spellCheck={false}
                  />
                </Row>
                <Row label={t("settings.gitConfig.scope")}>
                  <SegGroup<"local" | "global">
                    value={signScope}
                    options={[
                      { v: "local", label: t("settings.gitConfig.scope.local") },
                      { v: "global", label: t("settings.gitConfig.scope.global") },
                    ]}
                    onChange={setSignScope}
                  />
                </Row>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {t("settings.signing.help")}
                </p>
                <div className="flex items-center justify-end gap-2">
                  {signStatus && (
                    <span
                      className={cn(
                        "mr-auto text-[11px]",
                        signStatus.toLowerCase().includes("fail")
                          ? "text-destructive"
                          : "text-[hsl(var(--branch-1))]",
                      )}
                    >
                      {signStatus}
                    </span>
                  )}
                  <button
                    onClick={onSaveSigning}
                    disabled={signBusy}
                    className={cn(
                      "h-7 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:opacity-90",
                      signBusy && "cursor-not-allowed opacity-60",
                    )}
                  >
                    {signBusy ? t("settings.gitConfig.saving") : t("settings.gitConfig.save")}
                  </button>
                </div>
              </>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <header>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
      </header>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[140px_1fr] items-center gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div>{children}</div>
    </label>
  );
}

function SegGroup<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {options.map((o) => (
        <button
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          className={cn(
            "h-7 px-2.5 text-[11px]",
            o.v === value
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

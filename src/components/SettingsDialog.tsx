import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useApp } from "@/stores/app";
import { useSettings, type ThemeMode } from "@/stores/settings";
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
  const setSetting = useSettings((s) => s.set);
  const reset = useSettings((s) => s.reset);
  const locale = useI18n((s) => s.locale);
  const setLocale = useI18n((s) => s.setLocale);
  const t = useT();

  const [autocrlf, setAutocrlf] = useState<string>("");
  const [autocrlfScope, setAutocrlfScope] = useState<"local" | "global">("global");
  const [autocrlfBusy, setAutocrlfBusy] = useState(false);
  const [autocrlfStatus, setAutocrlfStatus] = useState<string | null>(null);

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

import { useEffect, useMemo, useState } from "react";
import { Button, CopyButton, DialogModal, EmptyState, IconButton, Textarea } from "@proxyshard/shardx-ui-kit";
import { PageBody, PageHeader } from "../../widgets/PageHeader";
import { AddIcon, AuthenticatorIcon, DeleteIcon } from "../../shared/icons";
import { Field } from "../../shared/ui/Field";
import { SelectField } from "../../shared/ui/SelectField";
import { useProfile } from "../../entities/profile";
import { ProfileIcon } from "../../shared/brands";
import { clip } from "../../shared/lib/clipboard";
import { toast } from "../../shared/model/toast";
import { confirmModal } from "../../shared/model/confirm";
import { useT } from "../../shared/i18n";
import { totpAdd, totpList, totpQuick, totpRemove, type TotpAccount, type TotpQuick } from "../../features/authenticator/api";

/** "123456" as "123 456", "12345678" as "1234 5678": easier to read off. */
const grouped = (code: string) => (code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : `${code.slice(0, 3)} ${code.slice(3)}`);

/// The time left on a code, as a ring that empties; red in its last five seconds.
function Countdown({ remaining, period }: { remaining: number; period: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const low = remaining <= 5;
  return (
    <span className="relative inline-grid size-[24px] shrink-0 place-items-center" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="absolute inset-0 -rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" strokeWidth="2.5" className="stroke-stroke-soft-200" />
        <circle
          cx="12" cy="12" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round"
          className={low ? "stroke-error-base" : "stroke-primary-base"}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - remaining / period)}
        />
      </svg>
      <span className={`text-micro tabular-nums ${low ? "text-error-base" : "text-text-sub-600"}`}>{remaining}</span>
    </span>
  );
}

/// One code row: its name, the code large, the countdown, and Copy.
function CodeRow({ title, subtitle, code, remaining, period, icon, onDelete }: {
  title: string;
  subtitle?: string;
  code: string;
  remaining: number;
  period: number;
  icon?: React.ReactNode;
  onDelete?: () => void;
}) {
  const t = useT();
  return (
    <div data-totp-row className="list-tile flex items-center gap-3 px-cell py-2.5">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-ui font-medium text-text-strong-950">{title}</div>
        {subtitle && <div className="truncate text-secondary text-text-soft-400">{subtitle}</div>}
      </div>
      <span data-totp-code className="mono text-panel-title tabular-nums text-text-strong-950">{grouped(code)}</span>
      <Countdown remaining={remaining} period={period} />
      <CopyButton
        label={t("authenticator.copy")}
        copiedLabel={t("authenticator.copied")}
        onCopy={async () => { await clip.write(code); }}
      />
      {onDelete && (
        <IconButton size="2xsmall" label={t("authenticator.remove", { name: title })} icon={<DeleteIcon className="size-3.5" />} onClick={onDelete} />
      )}
    </div>
  );
}

/// Authenticator: two-factor codes (TOTP, as Google Authenticator makes them)
/// for the accounts profiles sign in to. Saved accounts are kept sealed on
/// this computer and can be tied to a profile; the quick box makes codes
/// for pasted keys and keeps nothing, like 2FA.tools.
export function AuthenticatorPage() {
  const t = useT();
  const [accounts, setAccounts] = useState<TotpAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [paste, setPaste] = useState("");
  const [quick, setQuick] = useState<TotpQuick[]>([]);
  const profiles = useProfile((s) => s.profiles);

  // Codes are made by the backend, so the secrets never reach this page: asked again each second.
  useEffect(() => {
    let alive = true;
    const tick = () => {
      totpList().then((a) => { if (alive) { setAccounts(a); setError(null); } }, (e) => { if (alive) setError(String(e)); });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const lines = useMemo(() => paste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), [paste]);
  useEffect(() => {
    if (lines.length === 0) { setQuick([]); return; }
    let alive = true;
    const tick = () => { totpQuick(lines).then((q) => { if (alive) setQuick(q); }, () => {}); };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [lines]);

  const remove = async (a: TotpAccount) => {
    const name = a.issuer ? `${a.issuer}: ${a.label}` : a.label;
    const ok = await confirmModal({
      title: t("authenticator.removeTitle", { name }),
      message: t("authenticator.removeMessage"),
      confirmLabel: t("authenticator.removeConfirm"),
      danger: true,
    });
    if (!ok) return;
    try {
      await totpRemove(a.id);
      setAccounts((xs) => xs?.filter((x) => x.id !== a.id) ?? null);
    } catch (e) {
      toast.fail({ title: t("authenticator.removeFailed", { name }), detail: e });
    }
  };

  return (
    <>
      <PageHeader
        title={t("authenticator.title")}
        count={accounts ? accounts.length : undefined}
        help={{ title: t("authenticator.helpTitle"), body: t("authenticator.helpBody") }}
        actions={
          <Button variant="primary" mode="filled" size="xsmall" leftIcon={<AddIcon className="size-3.5" />} onClick={() => setAdding(true)}>
            {t("authenticator.add")}
          </Button>
        }
      />
      <PageBody>
        <div className="flex max-w-[760px] flex-col gap-6">
          <section aria-labelledby="totp-saved" className="flex flex-col gap-2">
            <h2 id="totp-saved" className="m-0 text-section-title text-text-strong-950">{t("authenticator.saved")}</h2>
            {error && <p className="m-0 text-secondary text-error-text">{error}</p>}
            {accounts && accounts.length === 0 && (
              <EmptyState
                icon={<AuthenticatorIcon />}
                title={t("authenticator.emptyTitle")}
                hint={t("authenticator.emptyHint")}
                action={{ label: t("authenticator.add"), icon: <AddIcon />, onClick: () => setAdding(true) }}
              />
            )}
            {accounts?.map((a) => {
              const profile = a.profile_id ? profiles.find((p) => p.id === a.profile_id) : undefined;
              const title = a.issuer || a.label;
              const subtitle = [a.issuer ? a.label : "", profile ? t("authenticator.forProfile", { name: profile.name }) : ""].filter(Boolean).join(", ");
              return (
                <CodeRow
                  key={a.id}
                  title={title}
                  subtitle={subtitle || undefined}
                  code={a.code}
                  remaining={a.remaining}
                  period={a.period}
                  icon={profile?.icon ? <ProfileIcon id={profile.icon} size={18} /> : undefined}
                  onDelete={() => void remove(a)}
                />
              );
            })}
          </section>

          <section aria-labelledby="totp-quick" className="flex flex-col gap-2">
            <h2 id="totp-quick" className="m-0 text-section-title text-text-strong-950">{t("authenticator.quick")}</h2>
            <p className="m-0 text-help text-text-sub-600">{t("authenticator.quickHelp")}</p>
            <Textarea
              aria-labelledby="totp-quick"
              className="mono"
              rows={3}
              placeholder={t("authenticator.quickPlaceholder")}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            {quick.map((q, i) =>
              q.code ? (
                <CodeRow key={i} title={q.label || t("authenticator.quickLine", { n: i + 1 })} code={q.code} remaining={q.remaining} period={q.period} />
              ) : (
                <p key={i} data-totp-error className="m-0 text-secondary text-error-text">
                  {t("authenticator.quickLine", { n: i + 1 })}: {q.error}
                </p>
              ),
            )}
          </section>
        </div>
      </PageBody>
      {adding && <AddAccount onClose={() => setAdding(false)} onAdded={(a) => setAccounts((xs) => [...(xs ?? []), a])} />}
    </>
  );
}

/// Add an account: its secret key (or the otpauth link a QR code holds), a
/// name, and the profile it belongs to.
function AddAccount({ onClose, onAdded }: { onClose: () => void; onAdded: (a: TotpAccount) => void }) {
  const t = useT();
  const profiles = useProfile((s) => s.profiles);
  const [secret, setSecret] = useState("");
  const [label, setLabel] = useState("");
  const [issuer, setIssuer] = useState("");
  const [profileId, setProfileId] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setProblem(null);
    try {
      const a = await totpAdd({ secret: secret.trim(), label: label.trim(), issuer: issuer.trim(), profile_id: profileId || null });
      onAdded(a);
      toast.ok(t("authenticator.added", { name: a.issuer || a.label }));
      onClose();
    } catch (e) {
      setProblem(String(e instanceof Error ? e.message : e));
    }
  };
  return (
    <DialogModal
      open
      onClose={onClose}
      dirty={!!secret}
      title={t("authenticator.addTitle")}
      confirmLabel={t("authenticator.addConfirm")}
      onConfirm={() => void submit()}
      isDisabled={!secret.trim()}
      cancelLabel={t("authenticator.cancel")}
      onCancel={onClose}
    >
      <div className="flex w-full min-w-0 flex-col gap-3 py-4">
        <Field label={t("authenticator.secretLabel")} value={secret} onChange={setSecret} placeholder={t("authenticator.quickPlaceholder")} mono secret error={problem ?? undefined} />
        <Field label={t("authenticator.nameLabel")} value={label} onChange={setLabel} placeholder="you@example.com" />
        <Field label={t("authenticator.issuerLabel")} value={issuer} onChange={setIssuer} placeholder={t("authenticator.issuerPlaceholder")} />
        <SelectField
          label={t("authenticator.profileLabel")}
          value={profileId}
          onChange={setProfileId}
          options={[{ value: "", label: t("authenticator.noProfile") }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]}
        />
        <p className="m-0 text-help text-text-soft-400">{t("authenticator.secretHelp")}</p>
      </div>
    </DialogModal>
  );
}

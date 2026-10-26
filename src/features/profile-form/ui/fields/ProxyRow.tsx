import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Combobox, Input, Popover } from "@proxyshard/shardx-ui-kit";
import { AddIcon, AlertIcon } from "../../../../shared/icons";
import { CountryFlag } from "../../../../shared/ui/CountryFlag";
import { ProxyFlag } from "../../../../shared/ui/ProxyFlag";
import { ProtocolPill } from "../../../../shared/ui/ProtocolPill";
import { ProxyAddress } from "../../../../shared/ui/ProxyAddress";
import { PropertyButton, PropertyRow } from "../../../../shared/ui/peek";
import { useT } from "../../../../shared/i18n";
import { proxyMissing, useProfile } from "../../../../entities/profile";
import { bindRefusal, teamRefusal, useInTeam, useRightsChange } from "../../../../entities/space";
import { duplicateLabels, proxyAddressHint, proxyBulkParse, proxyLabel, type ProxyEntry } from "../../../../entities/proxy";

/** The choice that stands for the form's proxy still to be added. */
const NEW = "new:";

/// The proxy one pasted line describes, read by the same code bulk import
/// uses (a read, never a write), as it is typed: null while there is
/// nothing to read or it reads as no proxy.
export function useParsedLine(line: string): ProxyEntry | null {
  const [parsed, setParsed] = useState<{ line: string; entry: ProxyEntry | null } | null>(null);
  useEffect(() => {
    const text = line.trim();
    if (!text) return;
    let alive = true;
    // Each try is a round trip to the backend: not on every key.
    const timer = setTimeout(() => {
      proxyBulkParse(text, "socks5")
        .then((rows) => { if (alive) setParsed({ line, entry: rows[0] ?? null }); })
        .catch(() => { if (alive) setParsed({ line, entry: null }); });
    }, 180);
    return () => { alive = false; clearTimeout(timer); };
  }, [line]);
  return line.trim() && parsed?.line === line ? parsed.entry : null;
}

/// A profile's proxy as a property row, its picker in place: "No proxy",
/// then every proxy, searchable, with a second step that adds one from a
/// pasted line. The profile form keeps the line (`newLine`) and adds it when
/// the form is saved, the pick showing it marked New until then.
export function ProxyRow({ value, onChange, newLine = "", onNewLine }: {
  value: string | null;
  onChange: (id: string | null) => void;
  newLine?: string;
  onNewLine: (line: string) => void;
}) {
  const t = useT();
  const proxies = useProfile((s) => s.proxies);
  const profiles = useProfile((s) => s.profiles);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const pending = useParsedLine(newLine);
  const proxy = value ? proxies.find((p) => p.id === value) : undefined;
  // In a team a proxy off this member's list is one they may not see: it comes with the profile.
  const team = useInTeam();
  useRightsChange();
  const missing = !newLine && !team && proxyMissing({ proxy_id: value }, proxies);
  const hidden = !newLine && team && !!value && !proxy;
  // A team's new proxy needs Create on it (doors.rs InlineProxy).
  const noCreate = !!teamRefusal("create");
  const addLabel = t("profileForm.addNewProxy");
  // Built only while the picker is open: 1,000 proxies are 1,000 rows (PERF-15).
  const options = useMemo(() => {
    if (!open) return [];
    const usedBy = new Map<string, number>();
    for (const p of profiles) if (p.proxy_id) usedBy.set(p.proxy_id, (usedBy.get(p.proxy_id) ?? 0) + 1);
    const shared = duplicateLabels(proxies);
    return [
      ...(newLine ? [{ value: NEW, label: pending?.name || newLine.split(":")[0], hint: t("profileForm.newProxy") }] : []),
      { value: "", label: t("peek.noProxy") },
      ...proxies.map((p) => {
        const n = p.id === value ? 0 : usedBy.get(p.id) ?? 0;
        const label = proxyLabel(p);
        const isShared = shared.has(label);
        const used = n === 1 ? t("peek.proxyUsedByOne") : n > 1 ? t("peek.proxyUsedBy", { n }) : null;
        const refused = team && p.id !== value ? bindRefusal(p.id) : null;
        if (refused) return { value: p.id, label, hint: refused, disabled: true, icon: <ProxyFlag cc={p.country} height={14} />, keywords: [p.host, p.country, p.kind].filter(Boolean) };
        return {
          value: p.id,
          label,
          // Taken by other profiles says so (O9b: two profiles behind one IP);
          // a free one shows its address. A name another proxy has too shows
          // the address and country first, to tell them apart (owner item 11),
          // and still says so when it is taken.
          hint: isShared ? [proxyAddressHint(p, true), used].filter(Boolean).join(", ") : used ?? `${p.host}:${p.port}`,
          icon: <ProxyFlag cc={p.country} height={14} />,
          keywords: [p.host, p.country, p.kind].filter(Boolean),
        };
      }),
    ];
  }, [open, proxies, profiles, value, newLine, pending, t, team]);
  const close = () => { setOpen(false); anchor.current?.focus(); };
  return (
    <PropertyRow id="proxy" label={t("peek.proxy")}>
      {(labelId) => (
        <>
          <PropertyButton ref={anchor} labelledBy={labelId} empty={!value && !newLine} expanded={open} onClick={() => setOpen((v) => !v)}>
            {newLine ? (
              <>
                {pending?.country && <CountryFlag cc={pending.country} height={14} />}
                <span className="min-w-0 truncate">{pending ? pending.name || `${pending.host}:${pending.port}` : newLine.split(":")[0]}</span>
                {pending && <ProtocolPill kind={pending.kind} />}
                <Badge size="small" color="primary" className="shrink-0">{t("profileForm.newProxy")}</Badge>
              </>
            ) : missing ? (
              <>
                <AlertIcon className="size-3.5 shrink-0 text-warning-base" />
                <span className="truncate text-warning-text">{t("profileRow.proxyMissing")}</span>
              </>
            ) : hidden ? (
              <span data-proxy-hidden className="truncate">{t("profileRow.proxyHidden")}</span>
            ) : proxy ? (
              <>
                {proxy.country && <CountryFlag cc={proxy.country} height={14} />}
                <span className="min-w-0 truncate">{proxy.name || `${proxy.host}:${proxy.port}`}</span>
                <ProtocolPill kind={proxy.kind} />
              </>
            ) : (
              <span className="truncate">{t("peek.noProxy")}</span>
            )}
          </PropertyButton>
          {/* The list, with the way to add a proxy under it: the one picker
              with a second step, so it holds both. */}
          <Popover
            open={open}
            onOpenChange={(o) => { setOpen(o); if (!o) setAdding(false); }}
            anchorRef={anchor}
            align="start"
            aria-label={adding ? addLabel : t("peek.proxy")}
          >
            <div style={{ width: 320 }}>
              {adding ? (
                <NewLinePanel
                  initial={newLine}
                  onCancel={() => setAdding(false)}
                  onAdd={(line) => { onNewLine(line); setAdding(false); close(); }}
                />
              ) : (
                <>
                  <Combobox
                    aria-label={t("peek.proxy")}
                    options={options}
                    value={newLine ? NEW : value ?? ""}
                    autoFocus
                    onChange={(v: string) => {
                      if (v !== NEW && ((v || null) !== value || newLine)) onChange(v || null);
                      close();
                    }}
                  />
                  {!noCreate && (
                    <div className="border-t border-stroke-soft-200 p-1">
                      <Button
                        variant="neutral" mode="ghost" size="3xsmall" contentAlign="start" className="w-full"
                        leftIcon={<AddIcon className="size-3.5" />}
                        onClick={() => setAdding(true)}
                      >
                        {addLabel}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </Popover>
        </>
      )}
    </PropertyRow>
  );
}

/** One pasted line, kept for the form's Save: what was understood shows
 *  under it before it is added; nothing is written here. */
function NewLinePanel({ initial, onCancel, onAdd }: { initial: string; onCancel: () => void; onAdd: (line: string) => void }) {
  const t = useT();
  const [line, setLine] = useState(initial);
  const parsed = useParsedLine(line);
  const add = () => { if (parsed) onAdd(line.trim()); };
  return (
    <div className="flex flex-col gap-2 p-2">
      {/* 4 px in from the popover's 12 px corner: the embedded field's 8 px stays concentric. */}
      <div className="-mx-[4px] -mt-[4px]">
        <Input
          autoFocus
          inputSize="xsmall"
          embedded
          className="mono"
          aria-label={t("profileForm.proxyLineLabel")}
          value={line}
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            // Never the dialog's Save: Enter here adds the line.
            if (e.key === "Enter") { e.preventDefault(); add(); }
          }}
          placeholder={t("proxySelect.linePlaceholder")}
        />
      </div>
      <div className="min-h-[34px] rounded-control bg-bg-weak-50 px-2.5 py-1.5 text-secondary">
        {parsed ? (
          <span className="text-text-sub-600">
            <strong className="text-text-strong-950">{parsed.name}</strong>
            {", "}
            <ProxyAddress kind={parsed.kind} host={parsed.host} port={parsed.port} country={parsed.country} />
            {parsed.username && `, ${parsed.username}`}
          </span>
        ) : (
          <span className="text-text-soft-400">{line.trim() ? t("proxySelect.parseFailed") : t("proxySelect.pasteHint")}</span>
        )}
      </div>
      <div className="flex justify-end gap-2 [&>button]:rounded-chip-sm">
        <Button variant="neutral" mode="ghost" size="3xsmall" onClick={onCancel}>{t("proxySelect.cancel")}</Button>
        <Button variant="primary" mode="filled" size="3xsmall" disabled={!parsed} onClick={add}>{t("profileForm.addProxyLine")}</Button>
      </div>
    </div>
  );
}

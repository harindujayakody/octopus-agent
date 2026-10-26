import { useId, useRef, useState, type ReactNode } from "react";
import { Button, IconButton, Input, Menu, SegmentControl, Switch, Textarea, cn, type MenuItem } from "@proxyshard/shardx-ui-kit";
import type { TrafficAction, TrafficRule } from "../../entities/automation";
import { AddIcon, ChevronRightIcon, CloseIcon } from "../../shared/icons";
import { useT } from "../../shared/i18n";
import { NumField } from "../../shared/ui/NumField";
import { SelectField } from "../../shared/ui/SelectField";
import { HeaderChips, HeaderRows } from "./HeaderFields";
import { BLOCK_REASONS, CHANGE_FIELDS, KINDS, METHODS, doLabel, doOf, kindLabel, reasonLabel, type DoKind } from "./rules";

/** An HTTP status is three digits, 100 to 599: anything else is not a
 *  response the browser can be handed. */
const HTTP_STATUS_MIN = 100;
const HTTP_STATUS_MAX = 599;

/** A group's small section label. */
const CAPTION = "text-section-label text-text-soft-400";

/** The changes that show only once added, through "+ More changes". */
type Extra = "setUrl" | "setMethod" | "delayMs" | "setStatus" | "setResponseBody";
const REQUEST_EXTRAS: Extra[] = ["setUrl", "setMethod", "delayMs"];
const RESPONSE_EXTRAS: Extra[] = ["setStatus", "setResponseBody"];

/// A folding section of a Change: Request or Response.
function Fold({ id, title, open, onToggle, children }: { id: string; title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {/* eslint-disable-next-line no-restricted-syntax -- a disclosure: a section title that folds */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex items-center gap-1.5 self-start rounded-control py-0.5 pr-1 text-ui text-text-sub-600 transition-hover hover:text-text-strong-950 focus-ring"
      >
        <ChevronRightIcon className={cn("size-3.5 text-icon-soft-400 transition-transform duration-(--motion-fast)", open && "rotate-90")} />
        {title}
      </button>
      {open && <div id={id} className="flex flex-col gap-2.5">{children}</div>}
    </div>
  );
}

/// The open rule's form. It shows only what the rule's action uses: Match,
/// then Do (Let through, Change, Block, Answer), then that choice's fields,
/// the pause switch, and Remove rule and Done.
export function RuleForm({ id, rule, onChange, onRemove, onDone }: {
  id: string;
  rule: TrafficRule;
  onChange: (r: TrafficRule) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const fid = useId();
  const m = rule.match;
  const a = rule.action;
  const regex = m.urlRegex !== undefined || m.hostRegex !== undefined;
  const doKind = doOf(a);
  const [hostShown, setHostShown] = useState(() => !!(m.host || m.hostRegex));
  // Changes set aside by "Let through", put back if Change comes back while
  // the form is open: a stray click costs nothing.
  const stash = useRef<Partial<TrafficAction>>({});
  const [added, setAdded] = useState<Set<Extra>>(() => new Set());
  const responseUsed = !!(a.setResponseHeaders?.length || a.removeResponseHeaders?.length || a.setStatus !== undefined || a.setResponseBody !== undefined);
  const requestUsed = !!(a.setHeaders?.length || a.removeHeaders?.length || a.setUrl !== undefined || a.setMethod !== undefined || a.delayMs !== undefined);
  const [requestOpen, setRequestOpen] = useState(requestUsed || !responseUsed);
  const [responseOpen, setResponseOpen] = useState(responseUsed);
  const moreAnchor = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const setMatch = (patch: Partial<typeof m>) => onChange({ ...rule, match: { ...m, ...patch } });
  const setAction = (patch: Partial<TrafficAction>) => onChange({ ...rule, action: { ...a, ...patch } });

  const toggleRegex = (on: boolean) => {
    if (on) onChange({ ...rule, match: { method: m.method, resource: m.resource, urlRegex: m.url ?? "", hostRegex: m.host ?? "" } });
    else onChange({ ...rule, match: { method: m.method, resource: m.resource, url: m.urlRegex ?? "", host: m.hostRegex ?? "" } });
  };

  const pickDo = (next: DoKind) => {
    if (next === doKind) return;
    if (next === "through") {
      const kept: Partial<TrafficAction> = {};
      const bare: TrafficAction = { ...a, type: "continue" };
      for (const k of CHANGE_FIELDS) {
        if (a[k] === undefined) continue;
        Object.assign(kept, { [k]: a[k] });
        delete bare[k];
      }
      stash.current = kept;
      onChange({ ...rule, action: bare });
    } else if (next === "change") {
      onChange({ ...rule, action: { ...stash.current, ...a, type: "modify" } });
      stash.current = {};
    } else {
      setAction({ type: next === "block" ? "block" : "fulfill" });
    }
  };

  const shown = (k: Extra) => a[k] !== undefined || added.has(k);
  const addExtra = (k: Extra) => {
    setAdded((s) => new Set(s).add(k));
    if (REQUEST_EXTRAS.includes(k)) setRequestOpen(true);
    else setResponseOpen(true);
  };
  const dropExtra = (k: Extra) => {
    setAdded((s) => { const n = new Set(s); n.delete(k); return n; });
    setAction({ [k]: undefined } as Partial<TrafficAction>);
  };
  const extraLabel = (k: Extra) =>
    k === "setUrl" ? t("trafficPanel.rewriteAddress")
    : k === "setMethod" ? t("trafficPanel.setMethodLabel")
    : k === "delayMs" ? t("trafficPanel.delayLabel")
    : k === "setStatus" ? t("trafficPanel.setStatusLabel")
    : t("trafficPanel.replaceBodyLabel");

  /** An added change: its caption, a way to take it away, and its field. */
  const extra = (k: Extra, field: (labelId: string) => ReactNode) => shown(k) && (
    <div key={k} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span id={`${fid}-${k}`} className="text-secondary text-text-sub-600">{extraLabel(k)}</span>
        <IconButton size="2xsmall" label={t("trafficPanel.removeChange")} icon={<CloseIcon className="size-3.5" />} onClick={() => dropExtra(k)} />
      </div>
      {field(`${fid}-${k}`)}
    </div>
  );

  const missing = [...REQUEST_EXTRAS, ...RESPONSE_EXTRAS].filter((k) => !shown(k));
  const moreItems: MenuItem[] = [
    ...(missing.some((k) => REQUEST_EXTRAS.includes(k)) ? [{ type: "label" as const, label: t("trafficPanel.requestSection") }] : []),
    ...missing.filter((k) => REQUEST_EXTRAS.includes(k)).map((k) => ({ label: extraLabel(k), onSelect: () => addExtra(k) })),
    ...(missing.some((k) => RESPONSE_EXTRAS.includes(k)) ? [{ type: "label" as const, label: t("trafficPanel.responseSection") }] : []),
    ...missing.filter((k) => RESPONSE_EXTRAS.includes(k)).map((k) => ({ label: extraLabel(k), onSelect: () => addExtra(k) })),
  ];

  // A method the list does not hold (typed before it was a list) stays a choice.
  const methodChoices = METHODS.filter(Boolean).concat(a.setMethod && !METHODS.includes(a.setMethod) ? [a.setMethod] : []);
  const reasons = BLOCK_REASONS.concat(a.blockReason && !BLOCK_REASONS.includes(a.blockReason) ? [a.blockReason] : []);

  return (
    <div id={id} data-rule-form className="flex flex-col gap-3 p-2.5">
      <div role="group" aria-labelledby={`${fid}-match`} className="flex flex-col gap-1.5">
        <span id={`${fid}-match`} className={CAPTION}>{t("trafficPanel.matchLabel")}</span>
        <Input
          inputSize="xsmall" className="mono" technical
          aria-label={t("trafficPanel.addressLabel")}
          placeholder={regex ? "^https://.*/api/" : "*://*.example.com/*"}
          value={(regex ? m.urlRegex : m.url) ?? ""}
          onChange={(e) => setMatch(regex ? { urlRegex: e.target.value } : { url: e.target.value })}
          rightAddon={
            <Button
              size="3xsmall" variant="neutral" mode="ghost"
              // Inside the field's frame: its ring sits inside the button.
              className="-mr-1 focus-ring-inset"
              aria-pressed={regex}
              onClick={() => toggleRegex(!regex)}
            >
              {t("trafficPanel.regexToggle")}
            </Button>
          }
        />
        {hostShown && (
          <Input
            inputSize="xsmall" className="mono" technical
            aria-label={t("trafficPanel.hostLabel")}
            placeholder={regex ? "^shop\\." : "*.example.com"}
            value={(regex ? m.hostRegex : m.host) ?? ""}
            onChange={(e) => setMatch(regex ? { hostRegex: e.target.value } : { host: e.target.value })}
          />
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <SelectField
            aria-label={t("trafficPanel.methodLabel")}
            value={m.method ?? ""}
            onChange={(v) => setMatch({ method: v || undefined })}
            options={METHODS.map((x) => ({ value: x, label: x || t("trafficPanel.anyMethod") }))}
          />
          <SelectField
            aria-label={t("trafficPanel.resourceLabel")}
            value={m.resource ?? ""}
            onChange={(v) => setMatch({ resource: v || undefined })}
            options={KINDS.map((x) => ({ value: x, label: kindLabel(t, x) }))}
          />
        </div>
        {!hostShown && (
          <Button
            variant="neutral" mode="ghost" size="2xsmall"
            className="self-start"
            leftIcon={<AddIcon className="size-3.5" />}
            aria-label={t("trafficPanel.addHost")}
            onClick={() => setHostShown(true)}
          >
            {t("trafficPanel.hostLabel")}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span id={`${fid}-do`} className={CAPTION}>{t("trafficPanel.doLabel")}</span>
        <SegmentControl
          size="xsmall"
          aria-labelledby={`${fid}-do`}
          // Each choice as wide as its word, so Let through fits 320 px.
          className="[&>button]:flex-auto [&>button]:px-[6px]"
          value={doKind}
          onChange={(v) => pickDo(v as DoKind)}
          items={(["through", "change", "block", "answer"] as const).map((d) => ({ value: d, label: doLabel(t, d) }))}
        />
      </div>

      {doKind === "change" && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`${fid}-302`} className="text-body text-text-strong-950">{t("trafficPanel.redirectSwitch")}</label>
            <Switch id={`${fid}-302`} checked={a.type === "redirect"} onChange={(on) => setAction({ type: on ? "redirect" : "modify" })} />
          </div>
          {a.type === "redirect" ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${fid}-to`} className="text-secondary text-text-sub-600">{t("trafficPanel.sendToLabel")}</label>
              <Input
                id={`${fid}-to`}
                inputSize="xsmall" className="mono" technical
                placeholder="https://…"
                value={a.setUrl ?? ""}
                onChange={(e) => setAction({ setUrl: e.target.value })}
              />
            </div>
          ) : (
            <>
              <Fold id={`${fid}-request`} title={t("trafficPanel.requestSection")} open={requestOpen} onToggle={() => setRequestOpen((v) => !v)}>
                <HeaderRows value={a.setHeaders} onChange={(v) => setAction({ setHeaders: v })} />
                <HeaderChips value={a.removeHeaders} onChange={(v) => setAction({ removeHeaders: v })} />
                {extra("setUrl", (labelId) => (
                  <Input
                    inputSize="xsmall" className="mono" technical
                    aria-labelledby={labelId}
                    placeholder="https://…"
                    value={a.setUrl ?? ""}
                    onChange={(e) => setAction({ setUrl: e.target.value || undefined })}
                  />
                ))}
                {extra("setMethod", (labelId) => (
                  <SelectField
                    aria-labelledby={labelId}
                    value={a.setMethod ?? ""}
                    placeholder={t("trafficPanel.anyMethod")}
                    onChange={(v) => setAction({ setMethod: v || undefined })}
                    options={methodChoices.map((x) => ({ value: x, label: x }))}
                  />
                ))}
                {extra("delayMs", (labelId) => (
                  /* Empty: no delay. */
                  <NumField
                    aria-labelledby={labelId}
                    value={a.delayMs ?? null}
                    min={0}
                    onChange={(v) => setAction({ delayMs: v || undefined })}
                    onClear={() => setAction({ delayMs: undefined })}
                  />
                ))}
              </Fold>
              <Fold id={`${fid}-response`} title={t("trafficPanel.responseSection")} open={responseOpen} onToggle={() => setResponseOpen((v) => !v)}>
                <HeaderRows value={a.setResponseHeaders} onChange={(v) => setAction({ setResponseHeaders: v })} />
                <HeaderChips value={a.removeResponseHeaders} onChange={(v) => setAction({ removeResponseHeaders: v })} />
                {extra("setStatus", (labelId) => (
                  /* Empty: the response keeps its own status. */
                  <NumField
                    aria-labelledby={labelId}
                    value={a.setStatus ?? null}
                    min={HTTP_STATUS_MIN}
                    max={HTTP_STATUS_MAX}
                    onChange={(v) => setAction({ setStatus: v })}
                    onClear={() => setAction({ setStatus: undefined })}
                  />
                ))}
                {extra("setResponseBody", (labelId) => (
                  <Textarea
                    className="mono" technical
                    aria-labelledby={labelId}
                    value={a.setResponseBody ?? ""}
                    onChange={(e) => setAction({ setResponseBody: e.target.value || undefined })}
                  />
                ))}
              </Fold>
              {moreItems.length > 0 && (
                <>
                  <Button
                    ref={moreAnchor}
                    variant="neutral" mode="ghost" size="2xsmall"
                    className="self-start"
                    leftIcon={<AddIcon className="size-3.5" />}
                    aria-haspopup="menu"
                    aria-expanded={moreOpen}
                    onClick={() => setMoreOpen((v) => !v)}
                  >
                    {t("trafficPanel.moreChanges")}
                  </Button>
                  <Menu open={moreOpen} onOpenChange={setMoreOpen} anchor={moreAnchor} aria-label={t("trafficPanel.moreChanges")} items={moreItems} />
                </>
              )}
            </>
          )}
        </div>
      )}

      {doKind === "block" && (
        <div className="flex flex-col gap-1.5">
          <span id={`${fid}-reason`} className={CAPTION}>{t("trafficPanel.reasonLabel")}</span>
          <SelectField
            aria-labelledby={`${fid}-reason`}
            value={a.blockReason ?? ""}
            onChange={(v) => setAction({ blockReason: v || undefined })}
            options={reasons.map((r) => ({ value: r, label: reasonLabel(t, r) }))}
          />
        </div>
      )}

      {doKind === "answer" && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1.5">
            {/* Captions tied by `htmlFor`: a wrapping label would read the
                field's message into its name. */}
            <label id={`${fid}-status-label`} htmlFor={`${fid}-status`} className={CAPTION}>{t("trafficPanel.statusLabel")}</label>
            <NumField id={`${fid}-status`} aria-labelledby={`${fid}-status-label`} value={a.status ?? 200} min={HTTP_STATUS_MIN} max={HTTP_STATUS_MAX} onChange={(v) => setAction({ status: v })} />
          </div>
          <div role="group" aria-labelledby={`${fid}-headers`} className="flex flex-col gap-1.5">
            <span id={`${fid}-headers`} className={CAPTION}>{t("trafficPanel.headersLabel")}</span>
            <HeaderRows value={a.responseHeaders} onChange={(v) => setAction({ responseHeaders: v })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${fid}-body`} className={CAPTION}>{t("trafficPanel.bodyLabel")}</label>
            <Textarea id={`${fid}-body`} className="mono" technical value={a.responseBody ?? ""} onChange={(e) => setAction({ responseBody: e.target.value })} />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${fid}-await`} className="text-body text-text-strong-950">{t("trafficPanel.pauseSwitch")}</label>
        <Switch id={`${fid}-await`} checked={!!rule.await} onChange={(on) => onChange({ ...rule, await: on })} />
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="neutral" mode="ghost" size="2xsmall"
          // Quiet until the pointer is on it: then the error color.
          className="not-aria-disabled:hover:bg-error-tint not-aria-disabled:hover:text-error-text"
          onClick={onRemove}
        >
          {t("trafficPanel.removeRule")}
        </Button>
        <Button variant="neutral" mode="stroke" size="2xsmall" className="ml-auto" onClick={onDone}>{t("trafficPanel.done")}</Button>
      </div>
    </div>
  );
}

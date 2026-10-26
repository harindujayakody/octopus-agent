import { useEffect, useId, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button, Tooltip, cn } from "@proxyshard/shardx-ui-kit";
import { toast } from "../../shared/model/toast";
import { useT } from "../../shared/i18n";
import { AddIcon } from "../../shared/icons";
import {
  trafficMount,
  trafficClear,
  trafficResolve,
  type TrafficAction,
  type TrafficRule,
  type TrafficPaused,
} from "../../entities/automation";
import { RuleForm } from "./RuleForm";
import { doLabel, doOf, emptyRule, ruleAddress, ruleScope } from "./rules";

/// The side panel's Traffic tab: the project's rules, one line each, with one
/// open at a time in its form; Apply now, which puts them on the running
/// browser to try; and the requests a rule paused, while there are some.
export function TrafficPanel({
  rules,
  onRulesChange,
  profileId,
  live,
  applied,
  onApplied,
  openRule,
}: {
  rules: TrafficRule[];
  onRulesChange: (rules: TrafficRule[]) => void;
  profileId: string | null;
  /** A profile runs in the browser column, so rules can be applied now. */
  live: boolean;
  /** What is on the running browser: the project rules applied (the same
   *  objects, so an edited rule no longer counts), or an empty set for a test
   *  rule from a request; null when nothing is. */
  applied: ReadonlySet<TrafficRule> | null;
  onApplied: (rules: ReadonlySet<TrafficRule> | null) => void;
  /** A rule just added from a request: its form opens. */
  openRule?: TrafficRule | null;
}) {
  const t = useT();
  const uid = useId();
  const [paused, setPaused] = useState<TrafficPaused[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    // Pauses belong to the profile they came from; another profile has none of them.
    setPaused([]);
    let un: (() => void) | null = null;
    let alive = true;
    listen<{ profile_id: string; params: { requestId: string; request: string } }>(
      "automation:traffic-paused",
      (e) => {
        if (!alive || !profileId || e.payload.profile_id !== profileId) return;
        let request: TrafficPaused["request"];
        try { request = JSON.parse(e.payload.params.request); }
        catch { request = { url: "?", method: "?", resource: "?", headers: {} }; }
        // A restarted browser numbers its pauses from await-1 again: an older
        // entry with the same id is a request that browser no longer holds.
        const requestId = e.payload.params.requestId;
        setPaused((prev) => [{ requestId, request }, ...prev.filter((x) => x.requestId !== requestId)].slice(0, 50));
      },
    ).then((u) => { un = u; });
    return () => { alive = false; un?.(); };
  }, [profileId]);

  // Each rule's key, held by the rule object itself. A rule has no id of its
  // own (its stored shape is the backend's). An index key handed a removed
  // rule's kept draft to the rule after it (F11 fix round 2), and keys kept
  // in a list beside the rules fell out of step when Undo put a removed rule
  // back (fix round 3). Undo and Redo put back the same objects, so their
  // keys come with them; an edit hands its rule's key to the new object; a
  // reload makes new objects and new keys, which is right: its drafts are stale.
  const ruleKeys = useRef({ next: 0, of: new WeakMap<TrafficRule, string>() }).current;
  const keyOf = (r: TrafficRule) => {
    let key = ruleKeys.of.get(r);
    if (!key) { key = `rule-${ruleKeys.next++}`; ruleKeys.of.set(r, key); }
    return key;
  };

  useEffect(() => {
    if (openRule && rules.includes(openRule)) setOpenKey(keyOf(openRule));
  }, [openRule]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (i: number, r: TrafficRule) => {
    ruleKeys.of.set(r, keyOf(rules[i]));
    onRulesChange(rules.map((x, j) => (j === i ? r : x)));
  };
  const remove = (i: number) => {
    if (keyOf(rules[i]) === openKey) setOpenKey(null);
    onRulesChange(rules.filter((_, j) => j !== i));
  };
  const add = () => {
    const r = emptyRule();
    setOpenKey(keyOf(r));
    onRulesChange([...rules, r]);
  };
  const rowId = (key: string) => `${uid}-${key}-row`;
  const close = (key: string) => {
    setOpenKey(null);
    document.getElementById(rowId(key))?.focus();
  };

  const apply = async () => {
    if (!profileId) return;
    try {
      if (applied) await trafficClear(profileId).catch(() => {});
      await trafficMount(profileId, rules);
      onApplied(new Set(rules));
      toast.ok(rules.length === 1 ? t("trafficPanel.appliedOne") : t("trafficPanel.appliedMany", { n: rules.length }));
    } catch (e) { toast.fail({ title: t("trafficPanel.mountFailed"), detail: e }); }
  };
  const clear = async () => {
    if (!profileId) return;
    try { await trafficClear(profileId); onApplied(null); toast.ok(t("trafficPanel.clearedToast")); }
    catch (e) { toast.fail({ title: t("trafficPanel.clearFailed"), detail: e }); }
  };

  const resolve = async (p: TrafficPaused, action?: TrafficAction) => {
    if (!profileId) return;
    try {
      await trafficResolve(profileId, p.requestId, action);
      setPaused((prev) => prev.filter((x) => x.requestId !== p.requestId));
    } catch (e) { toast.fail({ title: t("trafficPanel.resolveFailed"), detail: e }); }
  };

  const addButton = (
    <Button variant="neutral" mode="ghost" size="2xsmall" leftIcon={<AddIcon className="size-3.5" />} onClick={add}>
      {t("trafficPanel.addRule")}
    </Button>
  );

  // Only while a rule has paused something: no empty block.
  const pausedList = paused.length > 0 && (
    <section aria-labelledby={`${uid}-paused`} className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-1.5">
        <h3 id={`${uid}-paused`} className="m-0 text-section-label text-text-soft-400">{t("trafficPanel.pausedTitle")}</h3>
        <span className="text-secondary text-text-soft-400 tabular-nums">{paused.length}</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {paused.map((p) => (
          <li key={p.requestId} className="tile flex flex-col gap-1.5 p-2">
            <div className="text-secondary text-text-strong-950 wrap-anywhere">
              <span className="font-mono text-text-soft-400">{p.request.method}</span> {p.request.url}
            </div>
            <div className="flex flex-wrap gap-1">
              <Button variant="neutral" mode="stroke" size="2xsmall" onClick={() => resolve(p)}>{t("trafficPanel.doThrough")}</Button>
              <Button variant="neutral" mode="stroke" size="2xsmall" onClick={() => resolve(p, { type: "block", blockReason: "BlockedByClient" })}>{t("trafficPanel.doBlock")}</Button>
              <Button variant="neutral" mode="stroke" size="2xsmall" onClick={() => resolve(p, { type: "fulfill", status: 200, responseBody: "" })}>{t("trafficPanel.answer200")}</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );

  // Empty: no header controls, a centered state with the one way forward.
  if (rules.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-3">
        <div className="m-auto flex flex-col items-center gap-2 py-8 text-center">
          <p className="m-0 text-balance text-secondary text-text-soft-400">{t("trafficPanel.noRules")}</p>
          {addButton}
        </div>
        {pausedList}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <p className="m-0 min-w-0 flex-1 text-secondary text-text-soft-400">{t("trafficPanel.applyHint")}</p>
        <div className="flex shrink-0 items-center gap-1">
          {applied && <Button variant="neutral" mode="ghost" size="2xsmall" disabled={!live} onClick={clear}>{t("trafficPanel.clearButton")}</Button>}
          {/* Disabled is neutral, and its tooltip says why (no orange box). */}
          <Tooltip content={t("trafficPanel.applyUnavailable")} disabled={live}>
            <Button variant="neutral" mode="stroke" size="2xsmall" disabled={!live} onClick={apply}>{t("trafficPanel.applyNow")}</Button>
          </Tooltip>
        </div>
      </div>

      <div data-rules-list className="list-tile flex flex-col overflow-hidden pt-1">
        {rules.map((r, i) => {
          const key = keyOf(r);
          const open = key === openKey;
          const d = doOf(r.action);
          const formId = `${uid}-${key}-form`;
          return (
            <div
              key={key}
              data-rule-item
              data-open={open ? "" : undefined}
              className="row-line row-line-hover relative"
              // Esc closes the open form, from anywhere in it but a menu or a
              // list that floats over it (those are not inside it).
              onKeyDown={(e) => {
                if (e.key !== "Escape" || !open || e.defaultPrevented) return;
                if (!e.currentTarget.contains(e.target as Node)) return;
                e.preventDefault();
                close(key);
              }}
            >
              {/* eslint-disable-next-line no-restricted-syntax -- a rule's one line opens its form below it */}
              <button
                id={rowId(key)}
                data-rule-row
                type="button"
                aria-expanded={open}
                aria-controls={open ? formId : undefined}
                onClick={() => setOpenKey(open ? null : key)}
                className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-control px-cell py-2 text-left transition-hover hover:bg-bg-hover aria-expanded:row-fill-active focus-ring-inset"
              >
                <span className={cn("rounded-chip-sm px-1.5 py-0.5 text-micro", d === "block" ? "bg-error-tint text-error-text" : "control-fill text-text-sub-600")}>
                  {doLabel(t, d)}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-mono text-text-strong-950">{ruleAddress(t, r.match)}</span>
                  <span className="truncate text-secondary text-text-soft-400">{ruleScope(t, r.match)}</span>
                </span>
                {applied?.has(r) && <span className="text-secondary text-text-soft-400">{t("trafficPanel.applied")}</span>}
              </button>
              {open && (
                <RuleForm
                  id={formId}
                  rule={r}
                  onChange={(nr) => update(i, nr)}
                  onRemove={() => remove(i)}
                  onDone={() => close(key)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="self-start">{addButton}</div>
      {pausedList}
    </div>
  );
}

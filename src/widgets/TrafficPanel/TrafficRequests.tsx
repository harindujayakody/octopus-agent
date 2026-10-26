import { useState } from "react";
import { useScrollingFlag } from "../../shared/lib/useScrollingFlag";
import { Button, type MenuItem, Tooltip, useContextMenu } from "@proxyshard/shardx-ui-kit";
import { toast } from "../../shared/model/toast";
import { useT } from "../../shared/i18n";
import { trafficMount, type TrafficAction, type TrafficRule } from "../../entities/automation";
import { kindLabel, ruleFromRequest, type Observed } from "./rules";
import type { TrafficObserver } from "./useTrafficObserver";

// A header map as the "Name: value" lines the traffic step blocks take.
const recordToText = (h?: Record<string, string>) =>
  Object.entries(h ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n");

const hostOf = (url: string) => {
  try { return new URL(url).host; } catch { return url; }
};

const SUBTITLE = "text-secondary font-medium text-text-soft-400";

/// The browser column's Requests tab: Observe starts and stops the capture,
/// and each request the page makes is a row. A row's right-click (or its
/// details) adds a rule or a step from it, or tries a rule on the browser now.
export function TrafficRequests({
  observer,
  profileId,
  live,
  onAddStep,
  onAddRule,
  onMounted,
}: {
  observer: TrafficObserver;
  profileId: string | null;
  /** A profile runs in the browser column. */
  live: boolean;
  /** Drops a traffic step block into the project's flow. */
  onAddStep?: (kind: string, params: Record<string, unknown>, label: string) => void;
  /** Adds a rule to the project's Traffic rules. */
  onAddRule: (rule: TrafficRule) => void;
  /** A test rule went onto the running browser. */
  onMounted: () => void;
}) {
  const listScroll = useScrollingFlag();
  const t = useT();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rowMenu = useContextMenu();
  const { observing, observed } = observer;
  const selected = observed.find((r) => r.id === selectedId) ?? null;

  // Adds a traffic step block to the project flow, prefilled from this
  // request. Put it before the step that triggers the request and it mounts
  // there when the run reaches it: the rule lives in the flow like any step.
  const addStepFromRequest = (o: Observed, kind: string) => {
    const params: Record<string, unknown> = {
      url: o.url,
      ...(o.method ? { method: o.method } : {}),
      ...(o.resource && o.resource !== "any" ? { resource: o.resource } : {}),
    };
    let label = t("trafficPanel.stepLabelTraffic");
    if (kind === "traffic.block") {
      label = t("trafficPanel.stepLabelBlock");
    } else if (kind === "traffic.redirect") {
      params.to = "";
      label = t("trafficPanel.stepLabelRedirect");
    } else if (kind === "traffic.setHeaders") {
      if (o.requestHeaders) params.headers = recordToText(o.requestHeaders);
      if (o.requestBody) params.setBody = o.requestBody;
      label = t("trafficPanel.stepLabelRewriteRequest");
    } else if (kind === "traffic.editResponse") {
      if (o.status) params.status = o.status;
      if (o.responseHeaders) params.responseHeaders = recordToText(o.responseHeaders);
      if (o.responseBody != null) params.responseBody = o.responseBody;
      label = t("trafficPanel.stepLabelEditResponse");
    } else if (kind === "traffic.fulfill") {
      params.status = o.status ?? 200;
      if (o.responseHeaders) params.responseHeaders = recordToText(o.responseHeaders);
      params.responseBody = o.responseBody ?? "";
      label = t("trafficPanel.stepLabelFakeResponse");
    }
    if (!onAddStep) { toast.err(t("trafficPanel.cannotAddStep")); return; }
    onAddStep(kind, params, `${label} ${hostOf(o.url)}`);
    toast.ok(t("trafficPanel.stepAdded"));
  };

  const addRuleFromRequest = (o: Observed, type: TrafficAction["type"]) => {
    onAddRule(ruleFromRequest(o, type));
    toast.ok(t("trafficPanel.ruleAdded"));
  };

  // A rule from a request, on the running browser now, saved nowhere: to
  // check it before it goes into the project.
  const tryNow = async (o: Observed, type: TrafficAction["type"]) => {
    if (!profileId) { toast.err(t("trafficPanel.noLiveProfile")); return; }
    try {
      await trafficMount(profileId, [ruleFromRequest(o, type)]);
      onMounted();
      toast.ok(t("trafficPanel.mountedLiveTest"));
    } catch (e) { toast.fail({ title: t("trafficPanel.mountFailed"), detail: e }); }
  };

  const RULES = [["block", t("trafficPanel.doBlock")], ["modify", t("trafficPanel.doChange")], ["fulfill", t("trafficPanel.doAnswer")]] as const;
  const STEPS = [
    ["traffic.block", t("trafficPanel.quickBlock")],
    ["traffic.redirect", t("trafficPanel.quickRedirect")],
    ["traffic.setHeaders", t("trafficPanel.quickRewriteRequest")],
    ["traffic.editResponse", t("trafficPanel.quickEditResponse")],
    ["traffic.fulfill", t("trafficPanel.quickFakeResponse")],
  ] as const;
  const TRIES = [["modify", t("trafficPanel.doChange")], ["fulfill", t("trafficPanel.doAnswer")], ["block", t("trafficPanel.doBlock")]] as const;

  // Right-click on a request: a rule from it, a step from it, or a try.
  const requestMenu = (o: Observed): MenuItem[] => [
    { type: "label", label: t("trafficPanel.menuAddRule") },
    ...RULES.map(([type, label]) => ({ label, onSelect: () => addRuleFromRequest(o, type) })),
    { type: "separator" },
    { type: "label", label: t("trafficPanel.menuAddStepToProject") },
    ...STEPS.map(([kind, label]) => ({ label, disabled: !onAddStep, onSelect: () => addStepFromRequest(o, kind) })),
    { type: "separator" },
    { type: "label", label: t("trafficPanel.menuMountLiveTest") },
    ...TRIES.map(([type, label]) => ({ label, disabled: !live, onSelect: () => tryNow(o, type) })),
  ];

  // Nothing seen yet: no header controls, a centered state.
  if (observed.length === 0) {
    return (
      <div className="m-auto flex flex-col items-center gap-2 px-4 py-8 text-center">
        <p className="m-0 text-balance text-secondary text-text-soft-400">
          {!live ? t("trafficPanel.requestsNeedBrowser") : observing ? t("trafficPanel.requestsWatching") : t("trafficPanel.requestsEmpty")}
        </p>
        {live && (
          <Button variant="neutral" mode="stroke" size="2xsmall" onClick={() => void observer.toggle()}>
            {observing ? t("trafficPanel.stopObserving") : t("trafficPanel.observe")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button variant="neutral" mode="stroke" size="2xsmall" disabled={!live && !observing} onClick={() => void observer.toggle()}>
          {observing ? t("trafficPanel.stopObserving") : t("trafficPanel.observe")}
        </Button>
        <span className="text-secondary text-text-soft-400 tabular-nums">{observed.length}</span>
        <Button mode="link" variant="neutral" size="3xsmall" className="ml-auto" onClick={() => { observer.clear(); setSelectedId(null); }}>
          {t("trafficPanel.clearRequests")}
        </Button>
      </div>
      <p className="m-0 text-secondary text-text-soft-400">{t("trafficPanel.rightClickHint")}</p>
      {/* Room for the rows' focus rings inside the scroller (padding, and the
          same negative margin so the rows keep their place). */}
      <div {...listScroll} className="scrollbar-on-scroll -mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 py-0.5">
        {observed.map((o) => (
          <Tooltip key={o.id} content={o.url}>
            {/* Fix round 1 (I3): a real control, selectable from the keyboard. */}
            {/* eslint-disable-next-line no-restricted-syntax -- selects the observed request; a row with no keyboard path */}
            <button
              type="button"
              onClick={() => setSelectedId(o.id)}
              onContextMenu={(e) => { setSelectedId(o.id); rowMenu.open(e, requestMenu(o), { heading: o.url }); }}
              className={"flex w-full shrink-0 items-center gap-2 rounded-chip px-1.5 py-1 text-left hover:bg-bg-hover focus-ring-inset " + (selectedId === o.id ? "row-fill-active" : "")}
            >
              <span className="w-[42px] shrink-0 font-mono text-micro font-normal text-text-soft-400">{o.method}</span>
              <span className="truncate text-secondary text-text-strong-950">{o.url}</span>
              {o.status ? <span className="shrink-0 text-micro font-normal text-text-soft-400 tabular-nums">{o.status}</span> : null}
              <span className="ml-auto shrink-0 text-micro font-normal text-text-soft-400">{kindLabel(t, o.resource)}</span>
            </button>
          </Tooltip>
        ))}
      </div>
      {selected && (
        <div className="tile flex max-h-[45%] shrink-0 flex-col gap-2 overflow-y-auto p-2 text-secondary">
          <div className="flex items-center gap-2">
            <span className="font-mono text-text-soft-400">{selected.method}</span>
            {selected.status
              ? <span className="control-fill rounded-chip-sm px-1 text-text-strong-950 tabular-nums">{selected.status}</span>
              : <span className="text-text-soft-400">…</span>}
            <span className="text-text-soft-400">{kindLabel(t, selected.resource)}</span>
            <Button mode="link" variant="neutral" size="3xsmall" className="ml-auto" onClick={() => setSelectedId(null)}>{t("trafficPanel.closeDetails")}</Button>
          </div>
          <div className="text-text-strong-950 wrap-anywhere">{selected.url}</div>

          {/* What the page sent. */}
          {((selected.requestHeaders && Object.keys(selected.requestHeaders).length > 0) || selected.requestBody) && (
            <div className="flex flex-col gap-1">
              <div className={SUBTITLE}>{t("trafficPanel.requestSent")}</div>
              {selected.requestHeaders && Object.keys(selected.requestHeaders).length > 0 && (
                <div className="font-mono text-micro font-normal text-text-sub-600">
                  {Object.entries(selected.requestHeaders).map(([k, v]) => (
                    <div key={k} className="wrap-anywhere"><span className="text-text-soft-400">{k}:</span> {v}</div>
                  ))}
                </div>
              )}
              {selected.requestBody && (
                <pre className="m-0 max-h-[84px] overflow-auto control-fill rounded-chip p-1.5 font-mono text-micro font-normal text-text-strong-950">{selected.requestBody}</pre>
              )}
            </div>
          )}

          {/* The real response that came back: read-only, as received. */}
          <div className="flex flex-col gap-1">
            <div className={SUBTITLE}>{t("trafficPanel.responseReceived")}</div>
            {selected.responseHeaders ? (
              <>
                <div className="font-mono text-micro font-normal text-text-sub-600">
                  <div className="wrap-anywhere"><span className="text-text-soft-400">{t("trafficPanel.statusLineLabel")}</span> {selected.status ?? "?"}</div>
                  {Object.entries(selected.responseHeaders).map(([k, v]) => (
                    <div key={k} className="wrap-anywhere"><span className="text-text-soft-400">{k}:</span> {v}</div>
                  ))}
                </div>
                <div className={SUBTITLE}>
                  {selected.responseBodyTruncated ? t("trafficPanel.bodyLabelTruncated") : t("trafficPanel.bodyLabel")}
                </div>
                <pre className="m-0 max-h-[140px] overflow-auto control-fill rounded-chip p-1.5 font-mono text-micro font-normal text-text-strong-950">{selected.responseBody || t("trafficPanel.emptyBody")}</pre>
              </>
            ) : selected.capture === false ? (
              <div className="text-text-soft-400">{t("trafficPanel.notCaptured", { kind: selected.resource })}</div>
            ) : (
              <div className="text-text-soft-400">{t("trafficPanel.waitingResponse")}</div>
            )}
          </div>

          {/* A rule, a step or a try from this exact request, prefilled. */}
          <div className="flex flex-col gap-1.5 pt-1.5">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-0.5 text-text-soft-400">{t("trafficPanel.addRuleGroup")}</span>
              {RULES.map(([type, label]) => (
                <Button key={type} size="2xsmall" variant="neutral" mode="stroke" onClick={() => addRuleFromRequest(selected, type)}>{label}</Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-0.5 text-text-soft-400">{t("trafficPanel.addStepToProject")}</span>
              {STEPS.map(([kind, label]) => (
                <Button key={kind} size="2xsmall" variant="neutral" mode="stroke" disabled={!onAddStep} onClick={() => addStepFromRequest(selected, kind)}>{label}</Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-0.5 text-text-soft-400">{t("trafficPanel.mountLiveTest")}</span>
              {TRIES.map(([type, label]) => (
                <Button key={type} size="2xsmall" variant="neutral" mode="stroke" disabled={!live} onClick={() => tryNow(selected, type)}>{label}</Button>
              ))}
            </div>
          </div>
        </div>
      )}
      {rowMenu.node}
    </div>
  );
}

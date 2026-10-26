import { useScrollingFlag } from "../../shared/lib/useScrollingFlag";
import { useId, useState, type ReactNode } from "react";
import { Button, Card, IconButton, Input, TabPanel, Tabs, Tooltip, cn } from "@proxyshard/shardx-ui-kit";
import { scriptRun, type RunState } from "../../entities/automation";
import type { ProfileMeta } from "../../entities/profile/model/types";
import { openElsewhere, profileRefusal, startRefusal } from "../../entities/profile";
import { CloseIcon, PlayIcon } from "../../shared/icons";
import { useT } from "../../shared/i18n";
import { SelectField } from "../../shared/ui/SelectField";
import { StatusPill } from "../../shared/ui/StatusPill";
import type { LiveBrowser } from "../../widgets/LiveView";

export type BrowserTab = "page" | "requests" | "log";

/// The editor's third column, there only while the browser is open: the
/// profile, its state, Record and Stop on top and a close button at the end
/// of that row (closing only hides the column: a browser that is open and a
/// run that goes stay as they are); Page (the live view),
/// Requests (Observe and the request list) and Run log under them; the
/// console at the bottom.
/** Why a team profile can't be driven from here, in an option's few words: Start and Cookies, and no other device on it. */
function driveRefusal(t: ReturnType<typeof useT>, p: ProfileMeta): string | null {
  const on = openElsewhere(p);
  if (on) return t("rights.openOn", { device: on.device_name || t("rights.anotherDevice") });
  return startRefusal(p) || profileRefusal(p, "cookies") ? t("rights.cannotDrive") : null;
}

export function BrowserColumn({
  profiles, target, onTarget, browser, recording, onRecording, tab, onTab, page, pageNote, requests, run, onClose,
}: {
  profiles: ProfileMeta[];
  target: string | null;
  onTarget: (id: string | null) => void;
  browser: LiveBrowser;
  recording: boolean;
  onRecording: (on: boolean) => void;
  tab: BrowserTab;
  onTab: (tab: BrowserTab) => void;
  /** The live view. */
  page: ReactNode;
  /** A quiet line under the page: how to add a step, or what is going on. */
  pageNote: ReactNode;
  requests: ReactNode;
  run: RunState | null;
  /** Hides the column. */
  onClose: () => void;
}) {
  const t = useT();
  const tabsId = `browser${useId().replace(/[^\w-]/g, "")}`;
  const [src, setSrc] = useState("");
  const [world, setWorld] = useState<"isolated" | "main">("isolated");
  const [out, setOut] = useState("");
  const logScroll = useScrollingFlag();

  // The console runs script in the page through the core's isolated world,
  // or the page's own.
  const runConsole = async () => {
    if (!target || !src.trim()) return;
    try {
      const r = await scriptRun(target, src, world);
      setOut(r.result);
    } catch (e) {
      // What failed in our words, then the page's own error on the next line.
      setOut(`${t("projectEditor.consoleError")}\n${String(e)}`);
    }
  };

  const targetRow = target ? profiles.find((p) => p.id === target) : undefined;
  const targetWhy = targetRow && !browser.live ? startRefusal(targetRow) ?? profileRefusal(targetRow, "cookies") : null;
  const running = run?.workers.filter((w) => w.status === "running").length ?? 0;
  const failed = run?.workers.filter((w) => w.status === "failed").length ?? 0;

  return (
    <Card data-browser-column className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1.5 p-2">
        <div className="min-w-0 flex-1">
          <SelectField
            aria-label={t("projectEditor.chooseProfile")}
            value={target ?? ""}
            onChange={(v) => onTarget(v || null)}
            options={[
              { value: "", label: t("projectEditor.chooseProfile") },
              ...profiles.map((p) => {
                const why = driveRefusal(t, p);
                return why ? { value: p.id, label: p.name, hint: why, disabled: true } : { value: p.id, label: p.name };
              }),
            ]}
          />
        </div>
        {browser.live ? (
          <>
            <StatusPill status={{ tone: "running", label: t("liveView.running"), dot: "success" }} />
            <Button
              variant={recording ? "error" : "neutral"}
              mode={recording ? "lighter" : "stroke"}
              size="2xsmall"
              aria-pressed={recording}
              onClick={() => onRecording(!recording)}
            >
              {recording ? t("liveView.stopRecording") : t("liveView.record")}
            </Button>
            <Button variant="neutral" mode="ghost" size="2xsmall" aria-label={t("liveView.stopLabel")} onClick={() => void browser.stop()}>
              {t("liveView.stop")}
            </Button>
          </>
        ) : browser.busy ? (
          <StatusPill status={{ tone: "starting", label: t("liveView.starting"), dot: "info" }} />
        ) : (
          <Tooltip content={targetWhy ?? t("liveView.chooseFirst")} disabled={!!target && !targetWhy}>
            <Button
              variant="neutral" mode="stroke" size="2xsmall"
              leftIcon={<PlayIcon className="size-3.5" />}
              disabled={!target || !!targetWhy}
              aria-description={targetWhy ?? undefined}
              onClick={() => void browser.start()}
            >
              {t("liveView.start")}
            </Button>
          </Tooltip>
        )}
        <IconButton
          size="2xsmall"
          label={t("projectEditor.closeBrowser")}
          icon={<CloseIcon className="size-3.5" />}
          onClick={onClose}
        />
      </div>

      <div className="shrink-0 px-2.5">
        <Tabs
          idBase={tabsId}
          aria-label={t("projectEditor.browserPanels")}
          value={tab}
          onChange={(v) => onTab(v as BrowserTab)}
          items={[
            { value: "page", label: t("projectEditor.tabPage") },
            { value: "requests", label: t("trafficPanel.requestsTitle") },
            { value: "log", label: t("projectEditor.runLog") },
          ]}
        />
      </div>

      {/* All three stay mounted: the page keeps its last frame and the
          request list its place when another tab is shown. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div hidden={tab !== "page"} className="flex min-h-0 flex-1 flex-col">
          <TabPanel tabsId={tabsId} value="page" className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
            <div className="min-h-0 flex-1">{page}</div>
            {pageNote && <p className="m-0 shrink-0 text-secondary text-text-soft-400">{pageNote}</p>}
          </TabPanel>
        </div>
        <div hidden={tab !== "requests"} className="flex min-h-0 flex-1 flex-col">
          <TabPanel tabsId={tabsId} value="requests" className="flex min-h-0 flex-1 flex-col p-2.5">
            {requests}
          </TabPanel>
        </div>
        <div hidden={tab !== "log"} className="flex min-h-0 flex-1 flex-col">
          <TabPanel tabsId={tabsId} value="log" className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
            {run && run.log.length > 0 ? (
              <>
                <p className="m-0 shrink-0 text-secondary text-text-soft-400 tabular-nums">
                  {t("projectEditor.runningCount", { n: running })}, {t("projectEditor.failedCount", { n: failed })}
                </p>
                <div {...logScroll} className="scrollbar-on-scroll min-h-0 flex-1 overflow-y-auto font-mono text-micro font-normal text-text-sub-600">
                  {run.log.slice(-200).map((l, i) => <div key={i} className="wrap-anywhere">{l}</div>)}
                </div>
              </>
            ) : (
              <p className="m-auto text-center text-balance text-secondary text-text-soft-400">{t("projectEditor.logEmpty")}</p>
            )}
          </TabPanel>
        </div>
      </div>

      {out && (
        <pre className="mx-2 mb-0 mt-0 max-h-[84px] shrink-0 overflow-auto control-fill rounded-control p-2 font-mono text-micro font-normal text-text-strong-950">{out}</pre>
      )}
      <div className={cn("flex shrink-0 items-center gap-1.5 p-2", out && "mt-2")}>
        <div className="w-[96px] shrink-0">
          <SelectField
            aria-label={t("projectEditor.consoleWorld")}
            value={world}
            onChange={setWorld}
            options={[
              { value: "isolated", label: t("projectEditor.worldIsolated") },
              { value: "main", label: t("projectEditor.worldMain") },
            ]}
          />
        </div>
        <Input
          inputSize="xsmall"
          className="mono"
          technical
          wrapperClassName="min-w-0 flex-1"
          aria-label={t("projectEditor.console")}
          placeholder="document.title"
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void runConsole(); }}
        />
        <Button variant="neutral" mode="stroke" size="2xsmall" disabled={!target} onClick={() => void runConsole()}>
          {t("projectEditor.consoleRun")}
        </Button>
      </div>
    </Card>
  );
}

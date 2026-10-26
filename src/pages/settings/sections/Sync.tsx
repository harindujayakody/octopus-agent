import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Card, Switch } from "@proxyshard/shardx-ui-kit";
import { CopyIcon } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { confirmModal } from "../../../shared/model/confirm";
import { useNav } from "../../../shared/model/navigation";
import { focusIsLost } from "../../../shared/lib/focus";
import { useDialogLife } from "../../../shared/lib/useDialogLife";
import { LoadError, LoadingRows } from "../../../shared/ui/ListStates";
import { useProfile } from "../../../entities/profile";
import { useSpace } from "../../../entities/space";
import { SyncStatusWord, syncError, useSync, useSyncLine, type SyncKinds, type SyncState } from "../../../entities/sync";
import { useCreateTeam } from "../../../features/create-team";
import { ConnectServerForm, DeviceNameDialog, DisconnectDialog, TeamServerPicker, copyInvite, syncNow } from "../../../features/sync-setup";
import { SettingRow, SettingsGroup } from "../SettingRow";

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/// Once no dialog is left open, puts the keyboard on `target()` if what held it
/// went with the view it was in (connecting or disconnecting swaps them).
function refocusOnceSettled(target: () => HTMLElement | null) {
  let frames = 0;
  const step = () => {
    const dialog = [...document.querySelectorAll("[role='dialog'], [role='alertdialog']")].some((el) => el.getClientRects().length > 0);
    if (dialog && ++frames < 60) { requestAnimationFrame(step); return; }
    if (focusIsLost() || document.activeElement?.closest("[inert]")) target()?.focus();
  };
  requestAnimationFrame(step);
}

/// The person's own sync across their computers, kept on a team server. It
/// acts at once: none of it waits for the page's Save.
export function SyncSection() {
  const t = useT();
  const state = useSync((s) => s.state);
  const [error, setError] = useState<string | null>(null);
  const load = () => useSync.getState().load().then(() => setError(null)).catch((e) => setError(String(e)));
  useEffect(() => { void load(); }, []);
  // Rendered here, not in the connected view: disconnecting must not unmount it before it closes.
  const [asking, setAsking] = useState(false);
  const life = useDialogLife(asking);
  const on = !!state?.connection;
  const was = useRef(on);
  useEffect(() => {
    if (was.current === on) return;
    was.current = on;
    refocusOnceSettled(() => document.querySelector<HTMLElement>(on
      ? "main [data-setting='sync-status'] button"
      : "main [data-sync='off'] :is(button, input):not([disabled])"));
  }, [on]);
  if (!state) {
    return error
      ? <Card><LoadError headingLevel={3} what={t("otherStates.sync")} error={error} onRetry={() => void load()} /></Card>
      : <LoadingRows rows={3} rowHeight={56} />;
  }
  return (
    <>
      {state.connection ? <Connected state={state} onDisconnect={() => setAsking(true)} /> : <NotConnected />}
      {life.mounted && <DisconnectDialog key={life.session} open={asking} onClose={() => setAsking(false)} />}
    </>
  );
}

function NotConnected() {
  const t = useT();
  return (
    <div data-sync="off" className="flex flex-col gap-[32px]">
      <p className="m-0 text-pretty text-body measure text-text-sub-600">{t("sync.intro")}</p>
      <SettingsGroup title={t("sync.ownTitle")} help={t("sync.ownHelp")}>
        {/* The first step for someone with no server yet: the guide. */}
        <SettingRow
          id="sync-setup"
          title={t("sync.setUpTitle")}
          help={t("sync.setUpHelp")}
          control={({ helpId }) => (
            <Button variant="neutral" mode="stroke" size="xsmall" aria-describedby={helpId} onClick={() => useCreateTeam.getState().setOpen(true, "sync")}>
              {t("sync.setUp")}
            </Button>
          )}
        />
        <ConnectServerForm />
      </SettingsGroup>
      <SettingsGroup title={t("sync.teamTitle")} help={t("sync.teamHelp")}>
        <TeamServerPicker />
      </SettingsGroup>
    </div>
  );
}

function Connected({ state, onDisconnect }: { state: SyncState; onDisconnect: () => void }) {
  const t = useT();
  const conn = state.connection!;
  const { status } = state;
  const line = useSyncLine(status);
  const [renaming, setRenaming] = useState(false);
  const renameLife = useDialogLife(renaming);
  const team = useSpace((s) => s.state?.teams.find((x) => x.id === conn.teamId));
  const host = hostOf(conn.server);
  const error = status.state === "error";
  return (
    <div data-sync="on" className="flex flex-col gap-[32px]">
      <SettingsGroup>
        <SettingRow
          id="sync-server"
          title={t("sync.serverRow")}
          help={conn.own ? t("sync.serverOwn", { host }) : team ? t("sync.serverTeam", { team: team.name, host }) : t("sync.serverOther", { host })}
          control={({ helpId }) => (
            <Button variant="neutral" mode="stroke" size="xsmall" aria-describedby={helpId} onClick={onDisconnect}>{t("sync.disconnect")}</Button>
          )}
        />
        <SettingRow
          id="sync-device"
          title={t("sync.deviceRow")}
          help={t("sync.deviceHelp", { name: conn.device_name })}
          control={({ helpId }) => (
            <Button variant="neutral" mode="stroke" size="xsmall" aria-describedby={helpId} onClick={() => setRenaming(true)}>{t("sync.deviceRename")}</Button>
          )}
        />
        <SettingRow
          id="sync-others"
          title={t("sync.othersRow")}
          help={t("sync.othersHelp")}
          control={({ helpId }) => (
            <Button variant="neutral" mode="stroke" size="xsmall" aria-describedby={helpId} leftIcon={<CopyIcon className="size-3.5" />} onClick={() => void copyInvite()}>
              {t("sync.copyInvite")}
            </Button>
          )}
        />
        <SettingRow
          id="sync-status"
          title={<SyncStatusWord line={line} state={status.state} />}
          help={error ? syncError(status.error, conn.own) : line.detail}
          control={({ helpId }) => (
            // Retry after an error; Sync now otherwise, held while it runs.
            <Button
              variant={error ? "primary" : "neutral"}
              mode={error ? "filled" : "stroke"}
              size="xsmall"
              aria-describedby={helpId}
              disabled={status.state === "syncing"}
              onClick={() => void syncNow()}
            >
              {error ? t("sync.retry") : t("sync.now")}
            </Button>
          )}
        />
      </SettingsGroup>
      <Kinds kinds={state.kinds} own={conn.own} host={host} />
      {renameLife.mounted && <DeviceNameDialog key={renameLife.session} open={renaming} onClose={() => setRenaming(false)} />}
    </div>
  );
}

/** "picked/all" of the profiles sync can carry here; "0/0" in a team's space. */
const usePickedCount = () => useProfile((s) => {
  let on = 0;
  let all = 0;
  for (const p of s.profiles) if (p.sync) { all++; if (p.sync.on) on++; }
  return `${on}/${all}`;
});

/** How many profiles sync while only picked ones do, and a way to pick. */
function Picked({ on, all }: { on: number; all: number }) {
  const t = useT();
  return (
    <p data-sync-picked className="m-0 flex flex-wrap items-baseline gap-x-2 text-help text-text-sub-600">
      <span>{on === 0 ? t("sync.pickedNone") : t("sync.pickedSome", { n: on, total: all })}</span>
      <Button mode="link" variant="primary" size="3xsmall" className="text-help underline" onClick={() => void useNav.getState().setSection("profiles", { focus: true })}>
        {t("sync.pickProfiles")}
      </Button>
    </p>
  );
}

/** What syncs: each switch is written at once, one write at a time, and shown before the answer comes. */
function Kinds({ kinds, own, host }: { kinds: SyncKinds; own: boolean; host: string }) {
  const t = useT();
  const draft = useSync((s) => s.kindsDraft);
  const shown = draft ?? kinds;
  const [picked, carried] = usePickedCount().split("/").map(Number);
  const change = async (next: SyncKinds) => {
    // Every profile's cookies and passwords to a server someone else runs: asked first.
    if (!own && next.profiles === "all" && shown.profiles !== "all") {
      const ok = await confirmModal({
        title: t("sync.allProfilesTitle", { host }),
        message: t("sync.allProfilesMessage"),
        confirmLabel: t("sync.allProfilesConfirm"),
      });
      if (!ok) return;
    }
    try {
      await useSync.getState().setKinds(next);
    } catch (e) {
      toast.fail({ title: t("sync.kindsFailed"), detail: syncError(e, own) });
    }
  };
  const row = (id: string, title: string, help: string | undefined, on: boolean, set: (on: boolean) => SyncKinds, below?: ReactNode) => (
    <SettingRow
      id={id}
      title={title}
      help={help}
      below={below}
      control={({ labelId, helpId }) => (
        <Switch aria-labelledby={labelId} aria-describedby={helpId} checked={on} onChange={(v) => void change(set(v))} />
      )}
    />
  );
  return (
    <SettingsGroup title={t("sync.kindsTitle")} help={t("sync.kindsHelp")}>
      {row("sync-profiles", t("sync.kindProfiles"), t("sync.kindProfilesHelp"), shown.profiles === "all", (on) => ({ ...shown, profiles: on ? "all" : "selected" }),
        shown.profiles === "all" || carried === 0 ? undefined : <Picked on={picked} all={carried} />)}
      {row("sync-proxies", t("sync.kindProxies"), t("sync.kindProxiesHelp"), shown.proxies === "all", (on) => ({ ...shown, proxies: on ? "all" : "bound" }))}
      {row("sync-folders", t("sync.kindFolders"), t("sync.kindFoldersHelp"), shown.folders_tags, (on) => ({ ...shown, folders_tags: on }))}
      {row("sync-bookmarks", t("sync.kindBookmarks"), undefined, shown.bookmarks, (on) => ({ ...shown, bookmarks: on }))}
      {row("sync-extensions", t("sync.kindExtensions"), t("sync.kindExtensionsHelp"), shown.extensions, (on) => ({ ...shown, extensions: on }))}
      {row("sync-automation", t("sync.kindAutomation"), t("sync.kindAutomationHelp"), shown.automation, (on) => ({ ...shown, automation: on }))}
    </SettingsGroup>
  );
}

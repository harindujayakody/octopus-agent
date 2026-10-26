import { useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, CopyButton, DialogModal, Input, SegmentControl } from "@proxyshard/shardx-ui-kit";
import { ExternalLinkIcon, SpaceTeamIcon, SyncedIcon } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";
import { clip } from "../../../shared/lib/clipboard";
import { useDialogLife } from "../../../shared/lib/useDialogLife";
import { GH_REPO_URL } from "../../../shared/lib/utils";
import { useNav } from "../../../shared/model/navigation";
import { useSpace } from "../../../entities/space";
import { teamError } from "../../../entities/team";
import { syncError, useSync } from "../../../entities/sync";
import { sayConnected } from "../../sync-setup/model/actions";
import { InviteFields, useInvite, withScheme } from "../../join-team";
import { TEAM_SERVER_PORT, binaryCommand, dockerCommand, dockerLogsCommand } from "../lib/commands";
import { useCreateTeam, type GuideMode } from "../model/store";

/** Where the downloaded program is published, beside the launcher's own releases. */
const RELEASES = `${GH_REPO_URL}/releases/latest`;

type Way = "docker" | "download";
type Os = "unix" | "windows";
/** The shell the program is most likely started from: this computer's. */
const hostOs = (): Os => (/Windows/i.test(navigator.userAgent) ? "windows" : "unix");

/** Mounted once, with the sidebar: open while `useCreateTeam` says so. */
export function CreateTeamHost() {
  const open = useCreateTeam((s) => s.open);
  const mode = useCreateTeam((s) => s.mode);
  const life = useDialogLife(open);
  return life.mounted ? <CreateTeamDialog key={life.session} open={open} mode={mode} onClose={() => useCreateTeam.getState().setOpen(false)} /> : null;
}

/** A shell line to copy: wraps where it must, copied whole. */
function CommandLine({ label, command }: { label: string; command: string }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-secondary font-medium text-text-sub-600">{label}</span>
      <div data-command className="relative rounded-control bg-bg-weak-50 py-2 ps-2.5 pe-9">
        <code className="block text-mono [overflow-wrap:anywhere] text-text-strong-950">{command}</code>
        <span className="absolute top-1.5 right-1.5">
          <CopyButton size="3xsmall" label={t("team.guideCopyCommand", { what: label })} onCopy={async () => { await clip.write(command); }} />
        </span>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="grid size-[22px] shrink-0 place-items-center rounded-full bg-bg-weak-50 text-secondary font-medium text-text-sub-600">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        <h3 className="m-0 text-ui font-medium text-text-strong-950">{title}</h3>
        {children}
      </div>
    </li>
  );
}

/// How to make a team: run the server, take the admin token it prints, join with it here.
/// Joined, the Team page opens. In "sync" mode the same server holds the person's own sync.
export function CreateTeamDialog({ open, mode = "team", onClose }: { open: boolean; mode?: GuideMode; onClose: () => void }) {
  const t = useT();
  const join = useSpace((s) => s.join);
  const connect = useSync((s) => s.connect);
  const sync = mode === "sync";
  const [name, setName] = useState("");
  const [way, setWay] = useState<Way>("docker");
  const [os, setOs] = useState<Os>(hostOs);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const invite = useInvite(() => setErr(null));
  const { ready } = invite;
  const code = { code: (s: string) => <code>{s}</code> };

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (sync) {
        // Settings stays open behind it, now connected; the tab puts the keyboard on Sync now.
        await connect({ server: withScheme(invite.server), token: invite.token.trim() });
        onClose();
        sayConnected();
        return;
      }
      if (!(await join(withScheme(invite.server), invite.token.trim()))) return;
      onClose();
      // The keyboard lands on the new page, not on the menu item that opened this.
      void useNav.getState().setSection("team", { focus: true });
    } catch (e) {
      setErr(sync ? syncError(e) : teamError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogModal
      open={open}
      onClose={onClose}
      size="lg"
      icon={sync ? <SyncedIcon className="size-3.5" /> : <SpaceTeamIcon className="size-3.5" />}
      title={sync ? t("sync.guideTitle") : t("team.guideTitle")}
      subtitle={sync ? t("sync.guideSubtitle") : t("team.guideSubtitle")}
      dirty={name.trim() !== "" || invite.dirty}
      confirmLabel={sync ? t("sync.guideConnect") : t("team.guideJoin")}
      onConfirm={() => void submit()}
      isLoading={busy}
      isDisabled={!ready}
      footerNote={err ? <span role="alert" data-guide-error className="text-error-text">{err}</span> : !ready ? t("team.joinNeedBoth") : undefined}
    >
      <ol className="m-0 flex list-none flex-col gap-5 p-0 py-4">
        <Step n={1} title={t("team.guideStep1")}>
          {/* A sync server needs no team name. */}
          {!sync && (
            <Input
              inputSize="xsmall"
              label={t("team.teamName")}
              placeholder={t("team.guideNamePlaceholder")}
              hint={t("team.guideNameHint")}
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <SegmentControl
            aria-label={t("team.guideWay")}
            size="xsmall"
            fit
            value={way}
            items={[{ value: "docker", label: t("team.guideDocker") }, { value: "download", label: t("team.guideDownload") }]}
            onChange={(v) => setWay(v as Way)}
          />
          {way === "docker" ? (
            <CommandLine label={t("team.guideDocker")} command={dockerCommand(name)} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="neutral" mode="stroke" size="xsmall" rightIcon={<ExternalLinkIcon className="size-3.5" />} onClick={() => void openUrl(RELEASES).catch(() => {})}>
                  {t("team.guideReleases")}
                </Button>
                <SegmentControl
                  aria-label={t("team.guideOs")}
                  size="xsmall"
                  fit
                  value={os}
                  items={[{ value: "unix", label: t("team.guideOsUnix") }, { value: "windows", label: "Windows" }]}
                  onChange={(v) => setOs(v as Os)}
                />
              </div>
              <CommandLine label={os === "windows" ? t("team.guidePowerShell") : t("team.guideTerminal")} command={binaryCommand(name, os)} />
            </>
          )}
          {/* Where: every one of the person's computers must reach it, at any time. */}
          {sync && <p className="m-0 text-help text-text-strong-950">{t("sync.guideWhere")}</p>}
          <p className="m-0 text-help text-text-sub-600">{sync ? t.rich("sync.guideBindHelp", code) : t.rich("team.guideBindHelp", code)}</p>
          <p className="m-0 text-help text-text-sub-600">{sync ? t.rich("sync.guideDataHelp", code) : t.rich("team.guideDataHelp", code)}</p>
        </Step>
        <Step n={2} title={t("team.guideStep2")}>
          <p className="m-0 text-help text-text-sub-600">{sync ? t.rich("sync.guideTokenHelp", code) : t.rich("team.guideTokenHelp", code)}</p>
          {way === "docker" && <CommandLine label={t("team.guideDockerLogs")} command={dockerLogsCommand()} />}
        </Step>
        <Step n={3} title={sync ? t("sync.guideStep3") : t("team.guideStep3")}>
          <div className="flex flex-col gap-2">
            <InviteFields invite={invite} serverLabel={t("team.joinServer")} tokenLabel={t("team.guideAdminToken")} placeholder={`http://203.0.113.5:${TEAM_SERVER_PORT}`} />
            <p className="m-0 text-help text-text-sub-600">{sync ? t("sync.guideHttpNote") : t("team.guideHttpNote")}</p>
          </div>
        </Step>
      </ol>
    </DialogModal>
  );
}

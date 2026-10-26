import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, CopyButton, DataList, EmptyState, IconButton, Tooltip, cn, useLatched } from "@proxyshard/shardx-ui-kit";
import { HeaderMenu, PageBody, PageHeader } from "../../widgets/PageHeader";
import { AddIcon, EditIcon, FolderIcon, RenameIcon, SpaceTeamIcon } from "../../shared/icons";
import { t as tNow, useT } from "../../shared/i18n";
import { clip } from "../../shared/lib/clipboard";
import { focusIsLost, listStop, pageTitle } from "../../shared/lib/focus";
import { fmtDay, fmtRelative } from "../../shared/lib/utils";
import { useMinuteClock } from "../../shared/lib/useNow";
import { useDialogLife } from "../../shared/lib/useDialogLife";
import { useNav } from "../../shared/model/navigation";
import { toast } from "../../shared/model/toast";
import { LoadError, LoadingRows } from "../../shared/ui/ListStates";
import { useListLayout, type ListColumnDef } from "../../shared/ui/listHeader";
import { rowActionIcons } from "../../shared/ui/rowActionIcons";
import { useArrivedIds } from "../../shared/hooks/useArrivedIds";
import { activeTeam, useSpace, type TeamLink } from "../../entities/space";
import { leaveList, useProfile, useProfileUi } from "../../entities/profile";
import {
  RightsGrid, TEAM_ACTIONS, TeamFolderGlyph, actionName, summarize, teamError, useTeamAdmin,
  type Grant, type Preset, type RightsRow, type TeamFolder, type TeamMember, type TeamProfileRef,
} from "../../entities/team";
import { AddMemberDialog, NewInviteDialog, RenameTeamDialog, RightsDialog, RunConfirmDialog, TeamFolderDialog, useTeamAsk } from "../../features/team-admin";
import { useCreateTeam } from "../../features/create-team";
import { useJoinTeam } from "../../features/join-team";

type Dialog =
  | { kind: "add" }
  | { kind: "rename" }
  | { kind: "rights"; member: TeamMember }
  | { kind: "invite"; member: TeamMember }
  | { kind: "remove"; member: TeamMember }
  | { kind: "folder"; folder: TeamFolder | null }
  | { kind: "deleteFolder"; folder: TeamFolder };

/** A member with what their rules allow, in short; null when the overview did not bring their rules. */
type MemberItem = TeamMember & { access: string | null; noRights: boolean };

type MemberColumn = "name" | "status" | "access" | "added";
type FolderColumn = "name" | "profiles";

const added = (m: TeamMember) => fmtDay(`@${m.created_at}`);

/** Off wins; on, a member who has not used their invite yet is only invited. */
type MemberState = "active" | "invited" | "off";
const stateOf = (m: TeamMember): MemberState => (!m.active ? "off" : m.last_seen_at == null ? "invited" : "active");
const STATE_RANK: Record<MemberState, number> = { active: 0, invited: 1, off: 2 };
const stateWord = (m: TeamMember) => {
  const s = stateOf(m);
  return s === "active" ? tNow("team.statusActive") : s === "invited" ? tNow("team.statusInvited") : tNow("team.statusOff");
};

type Tr = ReturnType<typeof useT>;

/** A preset as a few words inside a sentence. */
const presetWords = (t: Tr, p: Preset) =>
  p === "view" ? t("team.sumView") : p === "run" ? t("team.sumRun") : p === "edit" ? t("team.sumEdit") : p === "full" ? t("team.sumFull") : "";

/** What a member's rules allow, place by place: "Whole team: start; Shops: edit, cookies". */
function accessText(t: Tr, grants: Grant[], profiles: TeamProfileRef[]): string {
  const parts = summarize(grants, TEAM_ACTIONS);
  if (parts.length === 0) return t("team.accessNoRights");
  return parts.map((p) => {
    const where = p.scope.kind === "team" ? t("team.wholeTeam")
      : p.scope.kind === "folder" ? p.scope.name || t("team.noFolder")
      : profiles.find((x) => x.id === (p.scope as { id: string }).id)?.name ?? p.scope.id;
    const what = p.preset ? presetWords(t, p.preset) : p.actions.map((a) => actionName(t, a).toLocaleLowerCase()).join(", ");
    return t("team.accessAt", { where, what });
  }).join(t("team.accessJoin"));
}

// Two short tables on the one list recipe: their columns size to their
// content and are the person's to size, move and sort, as every list's are.
const MEMBER_COLUMNS: readonly ListColumnDef<MemberColumn, MemberItem>[] = [
  {
    id: "name", title: (t) => t("team.colMember"), need: 160, min: 120, max: 400, shown: true, hideable: false, movable: false,
    text: (m) => m.name, compare: (a, b) => a.name.localeCompare(b.name),
  },
  {
    id: "status", title: (t) => t("team.colStatus"), need: 96, min: 80, max: 200, shown: true, hideable: true, movable: true,
    text: stateWord, compare: (a, b) => STATE_RANK[stateOf(a)] - STATE_RANK[stateOf(b)],
    // The pill's own padding beside its word.
    fit: (m, measure) => measure(stateWord(m), "secondary") + 16,
    cell: (m) => <MemberStatus member={m} />,
  },
  {
    id: "access", title: (t) => t("team.colAccess"), need: 240, min: 120, max: 640, shown: true, hideable: true, movable: true,
    text: (m) => m.access ?? "", role: "secondary",
    cell: (m) => m.access === null ? null : (
      <Tooltip content={m.access} whenTruncated>
        <span data-member-access className={cn("block min-w-0 truncate text-secondary", m.noRights ? "text-warning-text" : "text-text-sub-600")}>{m.access}</span>
      </Tooltip>
    ),
  },
  {
    id: "added", title: (t) => t("team.colAdded"), need: 88, min: 72, max: 200, shown: true, hideable: true, movable: true,
    text: added, role: "tabular", compare: (a, b) => a.created_at - b.created_at,
  },
];
/** The row's hover actions: Rights (64 px) and More (24), 4 apart. */
const MEMBER_ACTIONS = 96;

const FOLDER_COLUMNS: readonly ListColumnDef<FolderColumn, TeamFolder>[] = [
  {
    id: "name", title: (t) => t("team.colFolder"), need: 160, min: 120, max: 400, shown: true, hideable: false, movable: false,
    text: (f) => f.name, compare: (a, b) => a.name.localeCompare(b.name),
    fit: (f, m) => m(f.name, "ui") + 22,
    cell: (f) => (
      <span className="flex min-w-0 items-center gap-2">
        <TeamFolderGlyph color={f.color} />
        <Tooltip content={f.name} whenTruncated><span className="block min-w-0 truncate">{f.name}</span></Tooltip>
      </span>
    ),
  },
  {
    id: "profiles", title: (t) => t("team.colProfiles"), need: 80, min: 64, max: 200, shown: true, hideable: true, movable: true,
    text: (f) => String(f.profiles), role: "tabular", compare: (a, b) => a.profiles - b.profiles,
  },
];
/** Edit (24 px) and More (24), 4 apart. */
const FOLDER_ACTIONS = 52;

const STATE_COLOR = { active: "success", invited: "information", off: "gray" } as const;

/** Active, Invited or Switched off; on hover, when an active one was last seen, or that the invite waits. */
function MemberStatus({ member }: { member: TeamMember }) {
  const t = useT();
  const state = stateOf(member);
  const seen = state === "active" ? member.last_seen_at : null;
  // Moves on with the minute clock, and only when its words change.
  const when = useMinuteClock((now) => (seen == null ? "" : fmtRelative(`@${seen}`, now, false)));
  const tip = state === "invited" ? t("team.invitedTip") : when ? t("team.lastSeen", { when }) : null;
  const word = state === "active" ? t("team.statusActive") : state === "invited" ? t("team.statusInvited") : t("team.statusOff");
  const pill = <Badge shape="pill" color={STATE_COLOR[state]} data-member-status={state}>{word}</Badge>;
  return tip ? <Tooltip content={tip} warm={false}>{pill}</Tooltip> : pill;
}

/** The server's address beside the title, with Copy. */
function ServerFact({ server }: { server: string }) {
  const t = useT();
  let host = server;
  try { host = new URL(server).host; } catch { /* shown as given */ }
  return (
    <div data-team-server className="flex min-w-0 shrink items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
      <Tooltip content={server} whenTruncated>
        <span className="min-w-0 truncate text-mono text-text-soft-400">{host}</span>
      </Tooltip>
      <CopyButton size="3xsmall" label={t("team.copyServer")} onCopy={async () => { await clip.write(server); }} />
    </div>
  );
}

/// The team the launcher works in. Its admin manages members, their rights
/// and the team's folders here; a member sees what they may do.
export function TeamPage() {
  const t = useT();
  const st = useSpace((s) => s.state);
  const team = activeTeam(st);
  if (!team) {
    // Already in a team: the way back to it first.
    const joined = st?.teams.find((x) => !x.revoked && !x.needs_invite);
    const back = async (x: TeamLink) => {
      try {
        await useSpace.getState().choose({ kind: "team", team_id: x.id });
      } catch (e) {
        await useSpace.getState().load().catch(() => {});
        toast.fail({ title: t("sidebar.spaceSwitchFailed", { name: x.name }), detail: teamError(e) });
      }
    };
    return (
      <>
        <PageHeader title={t("team.pageTitle")} />
        <PageBody>
          {st && (joined ? (
            <EmptyState
              icon={<SpaceTeamIcon />}
              title={t("team.noTeamTitle")}
              hint={t("team.noTeamJoinedHint", { team: joined.name })}
              action={{ label: t("team.switchToTeam", { team: joined.name }), onClick: () => void back(joined) }}
              secondary={{ label: t("team.noTeamAction"), onClick: () => useCreateTeam.getState().setOpen(true) }}
            />
          ) : (
            <EmptyState
              icon={<SpaceTeamIcon />}
              title={t("team.noTeamTitle")}
              hint={t("team.noTeamHint")}
              action={{ label: t("team.noTeamAction"), icon: <AddIcon />, onClick: () => useCreateTeam.getState().setOpen(true) }}
              secondary={{ label: t("team.noTeamJoin"), onClick: () => useJoinTeam.getState().setOpen(true) }}
            />
          ))}
        </PageBody>
      </>
    );
  }
  return <TeamView key={team.id} team={team} />;
}

/** A list row by its id, where the keyboard goes when what held it is gone. */
const rowIn = (section: string, id: string) =>
  [...document.querySelectorAll<HTMLElement>(`main [data-team-section='${section}'] [data-row-id]`)].find((el) => el.dataset.rowId === id) ?? null;

function TeamView({ team }: { team: TeamLink }) {
  const t = useT();
  const load = useTeamAdmin((s) => s.load);
  const status = useTeamAdmin((s) => (s.teamId === team.id ? s.status : "loading"));
  const error = useTeamAdmin((s) => s.error);
  const overview = useTeamAdmin((s) => (s.teamId === team.id ? s.overview : null));
  const access = useTeamAdmin((s) => (s.teamId === team.id ? s.access : null));
  useEffect(() => { void load(team.id, team.admin); }, [load, team.id, team.admin]);

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const life = useDialogLife(dialog != null);
  const shown = useLatched(dialog);
  // Where the keyboard goes after the dialog, when what opened it is gone
  // (a row renamed or removed, a menu item): that row, else the list or the title.
  const after = useRef<() => HTMLElement | null>(() => null);
  const open = (d: Dialog, back?: () => HTMLElement | null) => {
    after.current = back ?? (() => null);
    setDialog(d);
  };
  // From a menu, a frame later: the menu first hands the keyboard back to its
  // trigger, and the dialog then returns it there.
  const openFromMenu = (d: Dialog, back?: () => HTMLElement | null) => requestAnimationFrame(() => open(d, back));
  const close = () => {
    setDialog(null);
    const back = after.current;
    // Two frames on, once the dialog has tried its own: a row's More button,
    // hidden again with the pointer gone, takes no focus.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const now = document.activeElement;
      if (!focusIsLost() && !now?.closest("[data-ending-style], [inert]")) return;
      (back() ?? listStop() ?? pageTitle())?.focus();
    }));
  };
  const name = overview?.team.name ?? team.name;
  const retry = () => void load(team.id, team.admin);

  // Add member asked for from the palette: opened once the page has the team.
  const askAdd = useTeamAsk((s) => s.addMember);
  useEffect(() => {
    if (!askAdd || !team.admin || !overview) return;
    useTeamAsk.getState().askAddMember(false);
    after.current = () => null;
    setDialog({ kind: "add" });
  }, [askAdd, team.admin, overview]);

  const memberBack = (m: TeamMember) => () => rowIn("members", m.id);
  const folderBack = useRef<string | null>(null);

  return (
    <>
      <PageHeader
        title={name}
        help={{ title: t("pageHelp.team.title"), body: team.admin ? t("pageHelp.team.body") : t("pageHelp.team.memberBody") }}
        after={<ServerFact server={team.server} />}
        actions={team.admin && overview ? (
          <>
            <Button variant="primary" mode="filled" size="xsmall" leftIcon={<AddIcon className="size-3.5" />} onClick={() => open({ kind: "add" })}>
              {t("team.addMember")}
            </Button>
            <HeaderMenu items={[{ label: t("team.renameItem"), icon: <RenameIcon className="size-3.5" />, onSelect: () => openFromMenu({ kind: "rename" }) }]} />
          </>
        ) : undefined}
      />
      <PageBody scrollKey={`team:${team.id}`}>
        {status === "error" ? (
          <LoadError what={team.admin ? t("team.overviewWhat") : t("team.accessWhat")} error={error} onRetry={retry} />
        ) : status !== "ready" ? (
          <LoadingRows rows={4} rowHeight={36} />
        ) : team.admin && overview ? (
          <div className="flex flex-col gap-6">
            {overview.members.length === 0 && <FirstSteps />}
            <MembersSection
              members={overview.members}
              grants={overview.grants}
              profiles={overview.profiles}
              onDialog={(d, fromMenu) => (fromMenu ? openFromMenu : open)(d, "member" in d ? memberBack(d.member) : undefined)}
            />
            <FoldersSection
              folders={overview.folders}
              onDialog={(d, fromMenu) => {
                const named = d.kind === "folder" && d.folder ? d.folder.name : d.kind === "deleteFolder" ? d.folder.name : null;
                folderBack.current = named;
                (fromMenu ? openFromMenu : open)(d, () => (folderBack.current ? rowIn("folders", folderBack.current) : null));
              }}
            />
          </div>
        ) : (
          <AccessSection grants={access ?? []} />
        )}
      </PageBody>

      {life.mounted && shown?.kind === "add" && (
        <AddMemberDialog
          key={life.session}
          open={dialog != null}
          onClose={close}
          onRights={(m) => open({ kind: "rights", member: m }, memberBack(m))}
        />
      )}
      {life.mounted && shown?.kind === "rename" && <RenameTeamDialog key={life.session} current={name} open={dialog != null} onClose={close} />}
      {life.mounted && shown?.kind === "rights" && <RightsDialog key={life.session} member={shown.member} open={dialog != null} onClose={close} />}
      {life.mounted && shown?.kind === "invite" && <NewInviteDialog key={life.session} member={shown.member} open={dialog != null} onClose={close} />}
      {life.mounted && shown?.kind === "remove" && (
        <RunConfirmDialog
          key={life.session}
          open={dialog != null}
          onClose={close}
          title={t("team.removeTitle", { name: shown.member.name })}
          message={t("team.removeMessage")}
          confirmLabel={t("team.removeConfirm")}
          run={async () => {
            await useTeamAdmin.getState().removeMember(shown.member.id);
            toast.ok(t("team.removed", { name: shown.member.name }));
          }}
        />
      )}
      {life.mounted && shown?.kind === "folder" && (
        <TeamFolderDialog key={life.session} folder={shown.folder} open={dialog != null} onClose={close} onSaved={(n) => { folderBack.current = n; }} />
      )}
      {life.mounted && shown?.kind === "deleteFolder" && (
        <RunConfirmDialog
          key={life.session}
          open={dialog != null}
          onClose={close}
          title={t("team.folderDeleteTitle", { name: shown.folder.name })}
          message={t("team.folderDeleteMessage")}
          confirmLabel={t("team.folderDeleteConfirm")}
          run={async () => {
            await useTeamAdmin.getState().deleteFolder(shown.folder.name);
            toast.ok(t("team.folderDeleted", { name: shown.folder.name }));
          }}
        />
      )}
    </>
  );
}

/** A team with nobody in it yet: the order things are done in. */
function FirstSteps() {
  const t = useT();
  const steps = [t("team.firstStep1"), t("team.firstStep2"), t("team.firstStep3"), t("team.firstStep4")];
  return (
    <section data-team-section="first-steps" className="list-tile flex flex-col gap-2 px-4 py-3">
      <h2 className="m-0 text-ui font-medium text-text-strong-950">{t("team.firstStepsTitle")}</h2>
      <ol className="m-0 flex list-decimal flex-col gap-1 ps-5 text-body text-text-sub-600">
        {steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
    </section>
  );
}

const listLabels = (t: Tr) => ({
  selectAll: t("dataList.selectAll"), select: (name: string) => t("dataList.select", { name }), more: t("pageHeader.more"), actions: t("profileTable.colActions"),
});

function MembersSection({ members, grants, profiles, onDialog }: {
  members: TeamMember[];
  grants: Record<string, Grant[]> | undefined;
  profiles: TeamProfileRef[];
  onDialog: (d: Dialog, fromMenu?: boolean) => void;
}) {
  const t = useT();
  const setActive = useTeamAdmin((s) => s.setActive);
  // A switch that failed says so here, over the list, until the next one.
  const [failed, setFailed] = useState<{ title: string; detail: string } | null>(null);
  const items = useMemo((): MemberItem[] => members.map((m) => {
    const rules = grants?.[m.id];
    return { ...m, access: rules ? accessText(t, rules, profiles) : null, noRights: !!rules && summarize(rules, TEAM_ACTIONS).length === 0 };
  }), [members, grants, profiles, t]);
  const list = useListLayout({
    storageKey: "shardx.teamMembers.layout",
    defs: MEMBER_COLUMNS,
    items,
    selectable: false,
    tail: MEMBER_ACTIONS,
    actionsLabel: t("profileTable.colActions"),
  });
  const arrived = useArrivedIds(members.map((m) => m.id), true);

  const toggle = async (m: TeamMember) => {
    setFailed(null);
    try {
      await setActive(m.id, !m.active);
      toast.ok(m.active ? t("team.switchedOff", { name: m.name }) : t("team.switchedOn", { name: m.name }));
    } catch (e) {
      setFailed({ title: m.active ? t("team.switchOffFailed", { name: m.name }) : t("team.switchOnFailed", { name: m.name }), detail: teamError(e) });
    }
  };

  return (
    <section data-team-section="members" className="flex flex-col gap-2">
      <div className="flex min-h-[30px] items-center gap-2">
        <h2 className="m-0 text-section-title text-text-strong-950">{t("team.membersTitle")}</h2>
        <span className="text-ui tabular-nums text-text-soft-400">{members.length}</span>
      </div>
      {failed && (
        <p role="alert" data-members-error className="m-0 text-help text-error-text">
          {failed.title}: <span className="text-text-sub-600">{failed.detail}</span>
        </p>
      )}
      <DataList<MemberItem>
        aria-label={t("team.membersTitle")}
        items={list.items}
        columns={list.columns}
        layout={list.layout}
        getId={(m) => m.id}
        getName={(m) => m.name}
        labels={listLabels(t)}
        status="ready"
        arrived={arrived}
        empty={
          <EmptyState
            icon={<SpaceTeamIcon />}
            title={t("team.membersEmpty")}
            hint={t("team.membersEmptyHint")}
            action={{ label: t("team.addMember"), icon: <AddIcon />, onClick: () => onDialog({ kind: "add" }) }}
          />
        }
        onOpen={(m) => onDialog({ kind: "rights", member: m })}
        onDelete={(ids) => {
          const m = members.find((x) => x.id === ids[0]);
          if (m) onDialog({ kind: "remove", member: m });
        }}
        rowActions={(m) => (
          <Button variant="neutral" mode="ghost" size="3xsmall" onClick={(e) => { e.stopPropagation(); onDialog({ kind: "rights", member: m }); }}>
            {t("team.rights")}
          </Button>
        )}
        menuItems={(m) => [
          { label: t("team.rights"), onSelect: () => onDialog({ kind: "rights", member: m }, true) },
          { label: m.active ? t("team.switchOff") : t("team.switchOn"), onSelect: () => void toggle(m) },
          { label: t("team.newInvite"), onSelect: () => onDialog({ kind: "invite", member: m }, true) },
          { type: "separator" },
          { label: t("team.remove"), icon: rowActionIcons.trash({ className: "size-3.5" }), danger: true, onSelect: () => onDialog({ kind: "remove", member: m }, true) },
        ]}
      />
    </section>
  );
}

/** Why a folder cannot go yet: the profiles still in it. */
const holds = (t: Tr, n: number) => (n === 1 ? t("team.folderHoldsOne") : t("team.folderHolds", { n }));

function FoldersSection({ folders, onDialog }: { folders: TeamFolder[]; onDialog: (d: Dialog, fromMenu?: boolean) => void }) {
  const t = useT();
  const list = useListLayout({
    storageKey: "shardx.teamFolders.layout",
    defs: FOLDER_COLUMNS,
    items: folders,
    selectable: false,
    tail: FOLDER_ACTIONS,
    actionsLabel: t("profileTable.colActions"),
  });
  const arrived = useArrivedIds(folders.map((f) => f.name), true);
  // Delete pressed on a folder that still holds profiles: why not, over the list.
  const [held, setHeld] = useState<TeamFolder | null>(null);
  const remove = (f: TeamFolder, fromMenu?: boolean) => {
    if (f.profiles > 0) { setHeld(f); return; }
    setHeld(null);
    onDialog({ kind: "deleteFolder", folder: f }, fromMenu);
  };
  // A folder opens as All profiles shows it: its profiles, in this team's space.
  const show = (f: TeamFolder) => {
    void leaveList(() => {
      useProfileUi.getState().setFolder(f.name);
      void useNav.getState().setSection("profiles", { focus: true });
    });
  };
  return (
    <section data-team-section="folders" className="flex flex-col gap-2">
      <div className="flex min-h-[30px] items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="m-0 text-section-title text-text-strong-950">{t("team.foldersTitle")}</h2>
          <span className="text-ui tabular-nums text-text-soft-400">{folders.length}</span>
        </div>
        <Button variant="neutral" mode="stroke" size="xsmall" leftIcon={<AddIcon className="size-3.5" />} onClick={() => onDialog({ kind: "folder", folder: null })}>
          {t("team.newFolder")}
        </Button>
      </div>
      <p className="m-0 max-w-[80ch] text-help text-text-sub-600">{t("team.foldersHelp")}</p>
      {held && (
        <p role="alert" data-folders-error className="m-0 text-help text-error-text">
          {t("team.folderDeleteFailed", { name: held.name })}: <span className="text-text-sub-600">{holds(t, held.profiles)}</span>
        </p>
      )}
      <DataList<TeamFolder>
        aria-label={t("team.foldersTitle")}
        items={list.items}
        columns={list.columns}
        layout={list.layout}
        getId={(f) => f.name}
        getName={(f) => f.name}
        labels={listLabels(t)}
        status="ready"
        arrived={arrived}
        empty={
          <EmptyState
            icon={<FolderIcon />}
            title={t("team.foldersEmpty")}
            hint={t("team.foldersEmptyHint")}
            secondary={{ label: t("team.newFolder"), onClick: () => onDialog({ kind: "folder", folder: null }) }}
          />
        }
        onOpen={show}
        onDelete={(ids) => {
          const f = folders.find((x) => x.name === ids[0]);
          if (f) remove(f);
        }}
        rowActions={(f) => (
          <IconButton
            size="3xsmall"
            label={t("team.folderEdit")}
            icon={<EditIcon className="size-3.5" />}
            onClick={(e) => { e.stopPropagation(); onDialog({ kind: "folder", folder: f }); }}
          />
        )}
        menuItems={(f) => [
          { label: t("team.folderShow"), onSelect: () => show(f) },
          { label: t("team.folderEdit"), icon: rowActionIcons.edit({ className: "size-3.5" }), onSelect: () => onDialog({ kind: "folder", folder: f }, true) },
          { type: "separator" },
          {
            label: t("team.folderDelete"),
            icon: rowActionIcons.trash({ className: "size-3.5" }),
            danger: true,
            disabled: f.profiles > 0,
            hint: f.profiles > 0 ? holds(t, f.profiles) : undefined,
            onSelect: () => remove(f, true),
          },
        ]}
      />
    </section>
  );
}

/// A member's own rights, read only: the rows their rules name, and what
/// wins in each cell. The server sends only rules about what they may See.
function AccessSection({ grants }: { grants: Grant[] }) {
  const t = useT();
  const profiles = useProfile((s) => s.profiles);
  const rows = useMemo((): RightsRow[] => {
    const out: RightsRow[] = [{ scope: { kind: "team" }, label: t("team.wholeTeam"), target: {} }];
    const seen = new Set<string>();
    for (const g of grants) {
      if (g.scope.kind !== "folder" || seen.has(`f:${g.scope.name}`)) continue;
      seen.add(`f:${g.scope.name}`);
      out.push({ scope: g.scope, label: g.scope.name || t("team.noFolder"), lead: <TeamFolderGlyph color="" />, target: { folder: g.scope.name } });
    }
    for (const g of grants) {
      if (g.scope.kind !== "profile" || seen.has(`p:${g.scope.id}`)) continue;
      const id = g.scope.id;
      seen.add(`p:${id}`);
      const p = profiles.find((x) => x.id === id);
      // A profile the launcher does not list yet: its own rules only, as its folder is not known here.
      out.push(p
        ? { scope: g.scope, label: p.name, hint: p.folder || t("team.noFolder"), target: { profileId: id, folder: p.folder ?? "" } }
        : { scope: g.scope, label: t("team.profileNotListed"), tip: t("team.profileNotListedTip", { id }), target: null });
    }
    return out;
  }, [grants, profiles, t]);

  return (
    <section data-team-section="access" className="flex flex-col gap-2">
      <h2 className="m-0 text-section-title text-text-strong-950">{t("team.accessTitle")}</h2>
      <p className="m-0 max-w-[80ch] text-help text-text-sub-600">{grants.length === 0 ? t("team.accessNone") : t("team.accessHelp")}</p>
      <div className="list-tile px-2 pt-1 pb-2">
        <RightsGrid rows={rows} grants={grants} label={t("team.accessTitle")} />
      </div>
    </section>
  );
}

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge, CopyButton, CountRoll, IconButton, Kbd, NavItem, Popover, Tooltip, cn, useContextMenu, useRovingFocus, type MenuItem } from "@proxyshard/shardx-ui-kit";
import {
  FolderAddIconApp,
  FOLDER_ICON_GLYPHS,
  MoreIcon,
  AuthenticatorIcon,
  NavAutomationIcon,
  NavBookmarksIcon,
  NavBrowsersIcon,
  NavExtensionsIcon,
  NavFingerprintsIcon,
  NavSettingsIcon,
  NavTrashIcon,
  RouteIcon,
  SearchIcon,
  OctopusLogo,
  OctopusMini,
  SidebarIcon,
  SpacePersonalIcon,
  SpaceTeamIcon,
  UnfoldMoreIcon,
} from "../../shared/icons";
import { FOLDER_CAP, useSidebarPrefs, type GroupId } from "./prefs";
import { useRailKey } from "./useRailKey";
import { LABEL_COLORS, labelColor, type LabelColorId } from "../../shared/constants";
import { titleBarOnMouseDown } from "../../shared/lib/dragWindow";
import { useNarrowWindow } from "../../shared/hooks/useNarrowWindow";
import type { RtUpdate, Section } from "../../shared/types";
import { useNav } from "../../shared/model/navigation";
import { useKeyPrefs } from "../../shared/model/keyPrefs";
import { useWhatsNew } from "../../shared/model/whatsNew";
import { useLang, useT } from "../../shared/i18n";
import {
  leaveList, profileStatus, proxyMissing, useAllViews, useFolderLook, useFolders, useProfile, useProfileUi, useRunningCount, useSaving,
  useViewCounts, useViews, viewName,
} from "../../entities/profile";
import { useProxy } from "../../entities/proxy";
import { leaveEditor } from "../../entities/automation";
import { useFingerprint } from "../../entities/fingerprint";
import { updatableCount, useExtensionUpdates } from "../../entities/extension";
import { apiInfo } from "../../entities/settings";
import { clip } from "../../shared/lib/clipboard";
import { toast } from "../../shared/model/toast";
import { deleteView } from "../../features/manage-views";
import { usePalette } from "../../features/command-palette";
import { ariaOf, capOf, menuItemsFor } from "../../features/commands";
import { command, findCommand } from "../../shared/commands";
import { useNow } from "../../shared/lib/useNow";
import { isContextMenuKey, openContextMenuFromKeys } from "../../shared/lib/keyboard";
import { readDragIds } from "../../shared/lib/profileDrag";
import { rowButtonHoverClass } from "../../shared/ui/RowHoverActions";
import { rowActionIcons } from "../../shared/ui/rowActionIcons";
import { FoldHeading } from "../../shared/ui/FoldHeading";
import { initialsOf } from "../../shared/lib/initials";
import { StatusDot } from "../../shared/ui/StatusDot";
import { ViewIcon } from "../../shared/ui/ViewIcon";
import type { ProfileMeta } from "../../entities/profile";
import { PERSONAL, activeTeam, adminRefusal, useInTeam, useRightsChange, useSpace, type Space, type TeamLink } from "../../entities/space";
import { teamError } from "../../entities/team";
import { JoinTeamHost, useJoinTeam } from "../../features/join-team";
import { CreateTeamHost, useCreateTeam } from "../../features/create-team";
import { useTeamTrashShown } from "../../features/team-trash";
import { confirmModal } from "../../shared/model/confirm";

/// The rail as drawn (`rail`): the user's choice (Mod+\ or the sidebar's
/// own button), or while Peek is open below 1280 px, where the list needs
/// the room (`byPeek`, LAYOUT-10), unless the user opened it again over that
/// Peek. Never forced by the width alone: a list that fits keeps every
/// Folder's name.
function useRailState(): { rail: boolean; byPeek: boolean } {
  const chosen = useSidebarPrefs((s) => s.rail);
  const overPeek = useSidebarPrefs((s) => s.overPeek);
  const narrow = useNarrowWindow();
  const section = useNav((s) => s.section);
  // Each read answers "does this Peek fold the rail now?", so a Peek opened
  // or closed where it cannot fold it (a wide window, another page) does not
  // draw the whole sidebar again: that render made Peek's turn-around start
  // late (craft item 6, peek-v2.spec.ts).
  const profilePeek = useProfileUi((s) => narrow && section === "profiles" && s.peekId !== null);
  const proxyPeek = useProxy((s) => narrow && section === "proxies" && s.peekId !== null);
  const fingerprintPeek = useFingerprint((s) => narrow && section === "fingerprints" && s.peekId !== null);
  const byPeek = profilePeek || proxyPeek || fingerprintPeek;
  return { rail: chosen || (byPeek && !overPeek), byPeek };
}

/** The rail as drawn now. */
export const useRail = (): boolean => useRailState().rail;

/** The sidebar panel's width, for the sidebar and for the startup frame
 *  that holds its place, so the app replaces the frame without a jump.
 *  The same on every system: the macOS traffic lights sit in the title strip
 *  above the panels (`shellPadClass`), not in the rail (owner, 2026-10-02).
 *  The full sidebar is 232, its 240 less the 8 px of ground beside it, so
 *  the page keeps its start (never bigger). */
export const sidebarWidthClass = (rail: boolean): string => (rail ? "w-[56px]" : "w-[232px]");

/** A Folder's color when it has none, stable per name: in the rail the icon
 *  is all there is, so two Folders must not look the same (LAYOUT-10). */
export function defaultFolderColor(name: string): LabelColorId {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return LABEL_COLORS[h % LABEL_COLORS.length].id;
}

/// Moves the profiles a drop carries: one row as before (a drop on the Folder
/// it is in says so), a dragged selection all at once. The selection stays as
/// it was (owner rule: bulk actions keep the selection); what failed is named
/// by the move's own toast.
function moveDropped(ids: string[], folder: string) {
  if (ids.length === 1) void useProfile.getState().setProfileFolder(ids[0], folder);
  else void useProfile.getState().moveMany(ids, folder);
}

/** Drag-and-drop props that make a sidebar item a drop target for profile rows. */
function useDropTarget(key: string, onDropProfiles: (ids: string[]) => void) {
  const dropTarget = useProfileUi((s) => s.dropTarget);
  const setDropTarget = useProfileUi((s) => s.setDropTarget);
  return {
    dropActive: dropTarget === key,
    // preventDefault on every dragover is what marks an element as a drop
    // target; skip it once and `drop` never fires.
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropTarget !== key) setDropTarget(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      // Only profiles we have: a dragged piece of foreign text (the text/plain
      // fallback) never becomes a Folder name's "profile".
      const known = new Set(useProfile.getState().profiles.map((p) => p.id));
      const ids = readDragIds(e.dataTransfer).filter((id) => known.has(id));
      if (ids.length > 0) onDropProfiles(ids);
    },
  };
}

/// A sidebar group: a named list (A11Y-19) whose heading folds it (owner
/// feedback 5s, LAYOUT-01). The heading is the small muted caps the owner
/// approved. In the compact rail it is a divider and nothing folds: every
/// item always shows there, whatever the saved state says.
function Group({ id, label, action, compact, children }: {
  id: GroupId;
  label: string;
  action?: ReactNode;
  compact: boolean;
  children: ReactNode;
}) {
  const collapsed = useSidebarPrefs((s) => !!s.collapsed[id]);
  const toggleGroup = useSidebarPrefs((s) => s.toggleGroup);
  const labelId = useId();
  const listId = useId();
  if (compact) {
    return (
      <div role="group" aria-labelledby={labelId} data-group={id} className="flex flex-col gap-0.5">
        <span id={labelId} className="sr-only">{label}</span>
        <div aria-hidden="true" className="mx-2 my-1.5 border-t border-stroke-soft-200" />
        {children}
      </div>
    );
  }
  return (
    <div role="group" aria-labelledby={labelId} data-group={id} className="flex flex-col gap-0.5">
      <div className="flex h-[24px] items-center gap-1.5 pl-2.5">
        {/* Fix round 1 (M8): the label first and the chevron after it, as
            Linear draws its disclosure (the shared FoldHeading, which the
            Profiles overview's sections use too). */}
        <FoldHeading label={label} labelId={labelId} open={!collapsed} controls={listId} onToggle={() => toggleGroup(id)} />
        <span className="min-w-0 flex-1" />
        {action}
      </div>
      {!collapsed && <div id={listId} className="flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}

function PageItem({ id, label, icon, compact, badge, badgeLabel }: {
  id: Section; label: string; icon: ReactNode; compact: boolean; badge?: ReactNode; badgeLabel?: string;
}) {
  const section = useNav((s) => s.section);
  const setSection = useNav((s) => s.setSection);
  // Its Go to key from the registry, in the rail's tooltip, as Search's
  // (mp4 review M11): Proxies G P, Fingerprints G F, Settings G S. None while
  // the Single-key shortcuts switch is off (O14): this item stays on screen
  // while the switch flips, so it follows it.
  useKeyPrefs((s) => s.singleKeys);
  const go = findCommand(`nav.${id}`);
  return (
    <NavItem
      size="small"
      data-nav={id}
      icon={icon}
      label={label}
      collapsed={compact}
      shortcut={go ? capOf(go) : undefined}
      aria-keyshortcuts={go ? ariaOf(go) : undefined}
      active={section === id}
      badge={badge}
      badgeLabel={badgeLabel}
      // A keyboard press (a click with no pointer, detail 0) puts the
      // keyboard on the page; a pointer click leaves it here (A11Y-04).
      // Automation, pressed on its own page, is the way back from a project
      // to the list, with the unsaved-changes question first.
      onClick={(e) => {
        const focus = e.detail === 0;
        if (id === "automation" && section === "automation") { void leaveEditor().then((ok) => { if (ok) void setSection(id, { focus }); }); return; }
        void setSection(id, { focus });
      }}
    />
  );
}

/// Extensions, with how many Web Store updates wait for the person (§3.7):
/// not the ones waiting for profiles or marked harmful. The rail has no room
/// for the badge: the count sits on the icon, and its name says it in words.
function ExtensionsItem({ compact }: { compact: boolean }) {
  const t = useT();
  const n = useExtensionUpdates((s) => updatableCount(s.byId));
  const rail = compact && n > 0;
  return (
    <PageItem
      id="extensions"
      label={rail ? (n === 1 ? t("sidebar.extensionsRailOne", { n }) : t("sidebar.extensionsRailMany", { n })) : t("sidebar.navExtensions")}
      icon={rail ? (
        <span className="relative flex">
          <NavExtensionsIcon className="size-3.5" />
          <Badge data-update-count aria-hidden="true" color="warning" size="small" shape="pill" className="absolute -top-2 left-2 min-w-[14px] px-[3px]! leading-none">{n}</Badge>
        </span>
      ) : <NavExtensionsIcon className="size-3.5" />}
      compact={compact}
      badge={n > 0 ? <Badge data-update-count color="warning" size="small">{n}</Badge> : undefined}
      badgeLabel={n > 0 ? (n === 1 ? t("sidebar.extensionUpdatesOne", { n }) : t("sidebar.extensionUpdatesMany", { n })) : undefined}
    />
  );
}

/// All Profiles: a fixed destination above the user's own lists, so neither
/// folding nor 12 Folders ever push it away (owner feedback 5s, LAYOUT-01).
/// Dropping a profile here takes it out of its Folder. It shows one count,
/// the total (CRAFT-17), which reads running/total while something runs, at
/// every scroll position (owner, 2026-09-30). Hovering the count explains it
/// with the words its name carries ("8 profiles, 2 running").
function AllProfilesItem({ compact }: { compact: boolean }) {
  const t = useT();
  const section = useNav((s) => s.section);
  const setSection = useNav((s) => s.setSection);
  const total = useProfile((s) => s.profiles.length);
  const folder = useProfileUi((s) => s.folder);
  const inView = useProfileUi((s) => s.viewId !== null);
  const setFolder = useProfileUi((s) => s.setFolder);
  const running = useRunningCount();
  // A8 (LQ-10): no number at all while the list is loading or failed — "0
  // profiles" would read as data loss.
  const ready = useProfile((s) => s.status === "ready");
  const allDrop = useDropTarget("__all__", (ids) => moveDropped(ids, ""));
  // The count in words: the rail's name, the full sidebar's name and the
  // count's tooltip all say this (one profile has no plural).
  const countWords = running > 0
    ? total === 1 ? t("sidebar.allProfilesRunningTooltipOne") : t("sidebar.allProfilesRunningTooltip", { total, n: running })
    : total === 1 ? t("sidebar.allProfilesCountOne") : t("sidebar.allProfilesCountMany", { total });
  return (
    <NavItem
      size="small"
      data-nav="profiles"
      icon={<NavBrowsersIcon className="size-3.5" />}
      // The compact rail has no heading to carry the running count, so it
      // folds into this item's own accessible name and tooltip instead (no
      // information lost). Fix round 2: the same `ready` gate as the count
      // itself — a running count from the process poll must not show while
      // the list is loading or failed (it would embed a total too, the LQ-10
      // "0 profiles" shape).
      label={compact && ready && running > 0 ? countWords : t("sidebar.allProfiles")}
      collapsed={compact}
      // Its key in the rail's tooltip (mp4 review M11).
      shortcut={capOf(command("nav.profiles"))}
      aria-keyshortcuts={ariaOf(command("nav.profiles"))}
      active={section === "profiles" && folder === "all" && !inView}
      onClick={(e) => { const focus = e.detail === 0; void leaveList(() => { setFolder("all"); void setSection("profiles", { focus }); }); }}
      // One count: the total, or running/total ("6/9") while something runs
      // (owner, 2026-09-30), in the total's own style and place. A screen
      // reader hears the words instead ("9 profiles, 6 running"), and a
      // pointer resting on the count sees them in a tooltip (the row's
      // children ignore the pointer for drag; the count takes it back, and
      // the drop target's leave check already counts it as inside).
      // Loading or failed: no number at all (A8, LQ-10). The rail shows no
      // badge: its name above carries both.
      // Live (spec 6.2): each number rolls on its own (CountRoll). The
      // running one sits in a slot as wide as the total, in tabular figures
      // (running never outgrows it), so the badge keeps its width and the
      // "/" and the total hold still when the running count gains a digit.
      // The slot is a ::before of that many zeros: not in the text.
      badge={ready ? (
        <>
          <Tooltip content={countWords}>
            <span aria-hidden="true" className="pointer-events-auto flex" data-running-of={running > 0 ? "" : undefined}>
              {/* The first start brings "N/" in with a fade: there is no
                  running number yet to roll from. */}
              {running > 0 && (
                <span className="flex transition-opacity duration-(--motion-base) ease-out starting:opacity-0">
                  <span
                    data-running
                    data-slot={"0".repeat(String(total).length)}
                    className="grid justify-items-end before:invisible before:content-[attr(data-slot)] before:[grid-area:1/1] *:[grid-area:1/1]"
                  >
                    <CountRoll value={running} />
                  </span>
                  /
                </span>
              )}
              <span data-total className="flex"><CountRoll value={total} /></span>
            </span>
          </Tooltip>
          <span className="sr-only">{countWords}</span>
        </>
      ) : undefined}
      {...allDrop}
    />
  );
}

/// The Folders, sorted, capped at 8 with "Show N more" (6.2). The Folder the
/// list shows stays listed past the cap, so "you are here" is never hidden.
function FoldersGroup({ compact }: { compact: boolean }) {
  const t = useT();
  const section = useNav((s) => s.section);
  const setSection = useNav((s) => s.setSection);
  const profiles = useProfile((s) => s.profiles);
  const folder = useProfileUi((s) => s.folder);
  const inView = useProfileUi((s) => s.viewId !== null);
  const setFolder = useProfileUi((s) => s.setFolder);
  const followFolderRename = useProfileUi((s) => s.followFolderRename);
  const setFolderDialog = useProfileUi((s) => s.setFolderDialog);
  const folders = useFolders();
  const ready = useProfile((s) => s.status === "ready");
  // In a team only its admin makes a folder: the button says so and does nothing.
  useRightsChange();
  const noNewFolder = adminRefusal();
  const newFolder = () => { if (!noNewFolder) setFolderDialog({ mode: "create" }); };
  const open = useSidebarPrefs((s) => s.foldersOpen);
  const setOpen = useSidebarPrefs((s) => s.setFoldersOpen);
  const ctx = useContextMenu();
  // One pass for every Folder's count, only when the list changes (PERF-20).
  const folderCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of profiles) if (p.folder) m.set(p.folder, (m.get(p.folder) ?? 0) + 1);
    return m;
  }, [profiles]);

  // A deleted or emptied Folder cannot stay selected: the list (or its View)
  // shows every Folder instead.
  useEffect(() => {
    if (folder !== "all" && !folders.includes(folder)) followFolderRename(folder, "all");
  }, [folders, folder, followFolderRename]);

  const openFolder = (f: string, focus: boolean) => {
    void leaveList(() => {
      setFolder(f);
      void setSection("profiles", { focus });
    });
  };
  const current = section === "profiles" && !inView ? folder : null;
  const capped = !open && folders.length > FOLDER_CAP;
  const shown = capped ? folders.filter((f, i) => i < FOLDER_CAP || f === current) : folders;
  const hidden = folders.length - shown.length;

  return (
    <Group
      id="folders"
      label={t("sidebar.groupFolders")}
      compact={compact}
      action={
        <IconButton
          label={noNewFolder ? t("rights.labelWhy", { label: t("sidebar.newFolder"), why: noNewFolder }) : t("sidebar.newFolder")}
          // Owner feedback 5r: a folder glyph, not a bare + (which reads as
          // "new profile"). Fix round 1, finding 4: the same row-button
          // hover rule as the list rows (the hover and active roles, with
          // the strong icon).
          icon={<FolderAddIconApp className="size-3.5" />}
          className={rowButtonHoverClass}
          size="3xsmall"
          disabled={!!noNewFolder}
          data-new-folder=""
          onClick={newFolder}
        />
      }
    >
      {shown.map((f) => (
        <FolderItem
          key={f}
          name={f}
          count={ready ? folderCounts.get(f) ?? 0 : undefined}
          compact={compact}
          active={current === f}
          onOpen={(e) => openFolder(f, e.detail === 0)}
          onDropProfiles={(ids) => moveDropped(ids, f)}
          // The registry's Folder commands, as the palette lists them (A11Y-13).
          onContextMenu={(e) => ctx.open(e, menuItemsFor("rowMenu", "folders", { ids: [f] }), { heading: f })}
        />
      ))}
      {/* One control in one place, so it keeps the keyboard focus as the
          list grows and shrinks around it (Pair 5 review). */}
      {(open ? folders.length > FOLDER_CAP : hidden > 0) && (
        <NavItem
          size="small"
          {...(open ? { "data-show-less": "" } : { "data-show-more": "" })}
          aria-expanded={open}
          icon={<MoreIcon className="size-3.5" />}
          label={open ? t("sidebar.showLess") : t("sidebar.showMore", { n: hidden })}
          collapsed={compact}
          onClick={() => setOpen(!open)}
        />
      )}
      {/* The heading, and its New folder button, are hidden in the rail. */}
      {compact && (
        <NavItem
          size="small"
          icon={<FolderAddIconApp className="size-3.5" />}
          label={noNewFolder ? t("rights.labelWhy", { label: t("sidebar.newFolder"), why: noNewFolder }) : t("sidebar.newFolder")}
          collapsed
          aria-disabled={noNewFolder ? true : undefined}
          onClick={newFolder}
        />
      )}
      {ctx.node}
    </Group>
  );
}


/// The built-in Views and the custom ones shown in the sidebar, each with the
/// number of profiles it shows.
function ViewsGroup({ compact }: { compact: boolean }) {
  const t = useT();
  const section = useNav((s) => s.section);
  const setSection = useNav((s) => s.setSection);
  const viewId = useProfileUi((s) => s.viewId);
  const applyView = useProfileUi((s) => s.applyView);
  const editView = useProfileUi((s) => s.editView);
  const setViewDialog = useProfileUi((s) => s.setViewDialog);
  const setPinned = useViews((s) => s.setPinned);
  const ctx = useContextMenu();
  const all = useAllViews();
  // A View applied, then hidden from the sidebar, stays listed (and
  // highlighted) until the list leaves it (PC-099, plan ruling 18): hiding
  // it must not take away the only sign of what the list shows.
  const shown = useMemo(
    () => all.filter((v) => v.builtin || v.pinned || (section === "profiles" && v.id === viewId)),
    [all, section, viewId],
  );
  const counts = useViewCounts(shown);
  // A8 (LQ-10): no count at all while the list is loading or failed — every
  // View reading "0" would read as data loss.
  const ready = useProfile((s) => s.status === "ready");
  return (
    <Group id="views" label={t("sidebar.groupViews")} compact={compact}>
      {shown.map((v) => (
        <NavItem
          size="small"
          key={v.id}
          data-view={v.id}
          icon={<ViewIcon kind={v.icon} className="size-3.5" />}
          label={viewName(v, t)}
          collapsed={compact}
          active={section === "profiles" && viewId === v.id}
          onClick={(e) => { const focus = e.detail === 0; void leaveList(() => { applyView(v.id); void setSection("profiles", { focus }); }); }}
          // Built-ins cannot change: no menu, and no Edit view (they keep Save as a copy).
          onContextMenu={v.builtin ? undefined : (e) => ctx.open(e, [
            // Opens the View with its own filters unlocked; Save view or Cancel ends it.
            { label: t("commands.editView"), onSelect: () => { void leaveList(() => { editView(v.id); void setSection("profiles"); }); } },
            { label: t("sidebar.viewRename"), onSelect: () => setViewDialog({ mode: "rename", id: v.id }) },
            // Listed only because it is applied (PC-099): offer the way back.
            v.pinned
              ? { label: t("sidebar.viewHide"), onSelect: () => setPinned(v.id, false) }
              : { label: t("sidebar.viewShow"), onSelect: () => setPinned(v.id, true) },
            { type: "separator" },
            { label: t("sidebar.viewDelete"), onSelect: () => deleteView(v.id), danger: true },
          ], { heading: v.name })}
          badge={ready ? <span data-count className="flex"><CountRoll value={counts[v.id]} /></span> : undefined}
          badgeLabel={ready ? countProfilesWords(t, counts[v.id]) : undefined}
        />
      ))}
      {ctx.node}
    </Group>
  );
}

/// Pinned profiles: a click shows one in the list and in Peek; its play (or
/// stop) button runs it (6.2, EMIL O-1).
function PinnedGroup({ compact }: { compact: boolean }) {
  const t = useT();
  const profiles = useProfile((s) => s.profiles);
  const pinned = useMemo(() => profiles.filter((p) => p.pinned), [profiles]);
  const ctx = useContextMenu();
  if (pinned.length === 0) return null;
  return (
    <Group id="pinned" label={t("sidebar.groupPinned")} compact={compact}>
      {pinned.map((p) => <PinnedItem key={p.id} profile={p} compact={compact} onMenu={ctx.open} />)}
      {ctx.node}
    </Group>
  );
}

/// A pinned profile. A click shows it in the list and in Peek, never starts
/// it: a start is a deliberate act, and a click that sometimes starts and
/// sometimes shows was two meanings on one gesture (6.2, EMIL O-1). The play
/// (or stop) button that shows on hover or focus runs it; its state is a
/// word, never the dot alone (Task 5f).
function PinnedItem({ profile: p, compact, onMenu }: {
  profile: ProfileMeta;
  compact: boolean;
  onMenu: (e: React.MouseEvent, items: MenuItem[], options?: { heading?: string }) => void;
}) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const now = useNow();
  const runningSince = useProfile((s) => s.running[p.id]);
  const isRunning = runningSince !== undefined;
  const startBusy = useProfile((s) => s.startBusy.has(p.id));
  const cancelled = useProfile((s) => s.cancelled.has(p.id));
  const stopping = useProfile((s) => s.pending[p.id]?.kind === "stop");
  const failedAt = useProfile((s) => s.startFailed[p.id]);
  const saving = useSaving((s) => s.ids.has(p.id));
  const proxies = useProfile((s) => s.proxies);
  const startStop = useProfile((s) => s.startStop);
  const show = () => {
    const ui = useProfileUi.getState();
    void ui.showInList(p.id).then((ok) => { if (ok) ui.openPeek(p.id); });
  };
  // Unpin takes this item away: the keyboard stays in the sidebar, on the
  // next pinned profile, else the one before, else All Profiles (PC-046:
  // focus fell to the page).
  const handOnFocus = () => {
    const items = [...document.querySelectorAll<HTMLElement>("aside [data-pinned]")];
    const at = items.findIndex((el) => el.dataset.pinned === p.id);
    const next = (items[at + 1] ?? items[at - 1])?.querySelector<HTMLElement>("button")
      ?? document.querySelector<HTMLElement>("aside [data-nav='profiles']");
    requestAnimationFrame(() => next?.focus());
  };
  // Fix round 1, finding 3: the same `profileStatus` the Profiles list and
  // Peek use, so a starting or idle pinned profile reads as its row does.
  const status = profileStatus(p, { starting: startBusy, cancelled, stopping, runningSince, failedAt, saving, now, lang, proxyMissing: proxyMissing(p, proxies) });
  return (
    <div data-pinned={p.id} className="group/pin relative">
      <NavItem
        size="small"
        // The rail has no word beside the item: its tooltip and name say
        // "running" (a word, never the dot alone).
        label={compact && isRunning ? t("sidebar.pinnedRunning", { name: p.name }) : p.name}
        collapsed={compact}
        // Owner fix 2 (2026-09-28): the pin glyph, not a bordered letter
        // tile; the same `rowActionIcons.pin` the row's pin toggle uses.
        // Decoration only: the name is the label. In the rail every item
        // would draw the same pin, so there it is the profile's two letters,
        // plain text (no tile, border, ring or fill). Running is the word in
        // its name and tooltip, as All Profiles says it in the rail: no dot
        // on the letters, which would be a status by dot alone (owner rule).
        icon={compact ? (
          <span data-initials aria-hidden="true" className="text-micro text-text-sub-600">
            {initialsOf(p.name)}
          </span>
        ) : rowActionIcons.pin({ className: "size-3.5" })}
        // Running is already in the rail's name; the other states are heard here.
        aria-description={compact && isRunning ? undefined : status.label}
        // A word, never the dot alone (Task 5f), through the one shared
        // StatusDot/profileStatus mapping (owner feedback 5i). It gives its
        // place to the play button on hover or focus.
        badge={
          <span
            data-running={isRunning || undefined}
            className="inline-flex items-center gap-1 text-secondary text-text-sub-600 group-hover/pin:invisible group-focus-within/pin:invisible"
          >
            <StatusDot tone={status.dot} pulse={status.tone === "starting" || status.tone === "stopping"} halo={status.tone === "running"} />
            {status.label}
          </span>
        }
        onClick={show}
        // The registry's Pinned menu (E3): Start or Stop, Show in list,
        // Unpin, with the icons and words the row menu uses.
        onContextMenu={(e) => onMenu(e, menuItemsFor("pinnedMenu", "profiles", { ids: [p.id] }, {
          onRun: (c) => { if (c.id === "profile.unpin") handOnFocus(); },
        }), { heading: p.name })}
      />
      {/* The rail has no room: its row menu keeps Start and Stop. */}
      {!compact && (
        <span data-pinned-action className="invisible absolute inset-y-0 right-[2px] flex items-center group-hover/pin:visible group-focus-within/pin:visible">
          <IconButton
            size="3xsmall"
            label={isRunning ? t("sidebar.stopProfile", { name: p.name }) : t("sidebar.startProfile", { name: p.name })}
            icon={rowActionIcons[isRunning ? "stop" : "start"]({ className: "size-3.5" })}
            className={rowButtonHoverClass}
            onClick={() => void startStop(p)}
          />
        </span>
      )}
    </div>
  );
}

/** A count heard with its noun ("3 profiles"), never as a bare number (A11Y-09). */
function countProfilesWords(t: ReturnType<typeof useT>, n: number): string {
  return n === 1 ? t("sidebar.countProfilesOne") : t("sidebar.countProfiles", { n });
}

function FolderItem({ name, count, compact, active, onOpen, onDropProfiles, onContextMenu }: {
  name: string;
  /** Loading or failed: no number at all (A8, LQ-10). */
  count?: number;
  compact: boolean;
  active: boolean;
  onOpen: (e: React.MouseEvent) => void;
  onDropProfiles: (ids: string[]) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const t = useT();
  const drop = useDropTarget(name, onDropProfiles);
  const look = useFolderLook(name);
  const Glyph = FOLDER_ICON_GLYPHS[look.icon] ?? FOLDER_ICON_GLYPHS.folder;
  // The full sidebar keeps an uncolored Folder neutral, as its owner left
  // it; the rail has no name to tell two Folders apart, so there every
  // Folder gets a color (LAYOUT-10).
  const color = labelColor(look.color ?? (compact ? defaultFolderColor(name) : null));
  return (
    <NavItem
      size="small"
      data-folder={name}
      icon={
        // The color through a class, never an inline one: the current Folder
        // in a Windows contrast theme draws its icon in HighlightText
        // (forced-selected), which an inline style would beat.
        <span
          data-folder-icon={look.icon}
          className={cn("flex", color && "text-(--label)")}
          style={color ? ({ "--label": color } as CSSProperties) : undefined}
        >
          <Glyph className="size-3.5" />
        </span>
      }
      label={name}
      collapsed={compact}
      active={active}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      badge={count !== undefined ? <span data-count className="flex"><CountRoll value={count} /></span> : undefined}
      badgeLabel={count !== undefined ? countProfilesWords(t, count) : undefined}
      {...drop}
    />
  );
}

type ApiState = { kind: "starting" } | { kind: "error" } | { kind: "off" } | { kind: "on"; port: number; url: string };

/** The local automation API's state: one 32 px row (a word and the port; the
 *  dot is decoration) that opens a small popover with the address and the way
 *  to its settings. Only what `api_info` reports is shown: no invented fields
 *  (the rest is backend B42). */
function ApiStatus({ compact }: { compact: boolean }) {
  const t = useT();
  const openSettings = useNav((s) => s.openSettings);
  const [state, setState] = useState<ApiState>({ kind: "starting" });
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Through the entity, so its first read (at start) is the running server.
    apiInfo()
      .then((i) => setState(i.enabled ? { kind: "on", port: i.port, url: i.base_url } : { kind: "off" }))
      .catch(() => setState({ kind: "error" }));
  }, []);
  const word = state.kind === "on" ? t("sidebar.apiOn") : state.kind === "off" ? t("sidebar.apiOff") : state.kind === "error" ? t("sidebar.apiError") : t("sidebar.apiStarting");
  // The visible word leads the name (WCAG 2.5.3), then what it is.
  const fullLabel = state.kind === "on" ? t("sidebar.apiOnLabel", { port: state.port }) : t("sidebar.apiNameOther", { word });
  const copy = async () => {
    if (state.kind !== "on") return;
    try {
      await clip.write(state.url);
      toast.ok(t("kit.copied"));
    } catch (e) {
      toast.fail({ title: t("copyField.failed"), detail: e });
      throw e;
    }
  };
  const dotClass = state.kind === "on" ? "bg-success-base" : state.kind === "off" ? "bg-idle" : "bg-warning-base";
  const dot = <span aria-hidden="true" className={cn("size-[7px] rounded-full forced-content", dotClass)} />;
  // Same look as the NavItem rows above (28 px, small), with the port after the
  // word and the copy icon's room kept empty at the end.
  const row = (
    // eslint-disable-next-line no-restricted-syntax -- a NavItem row whose label carries the port after the word
    <button
      ref={rowRef}
      type="button"
      data-api-status
      aria-label={fullLabel}
      aria-haspopup="dialog"
      // The rail has no fold headings: its tests count aria-expanded as one.
      aria-expanded={compact ? undefined : open}
      onClick={() => setOpen((o) => !o)}
      className={cn(
        "relative flex h-[28px] w-full shrink-0 items-center gap-[8px] rounded-control px-[8px] text-left text-ui focus-ring [&>*]:pointer-events-none",
        compact && "justify-center px-0",
        // Active equals hover (owner, 2026-10-01); pressed one step darker.
        open ? "bg-bg-hover text-text-strong-950 active:bg-bg-active" : "bg-transparent text-text-sub-600 hover:bg-bg-hover hover:text-text-strong-950 active:bg-bg-active",
      )}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">{dot}</span>
      {!compact && (
        <span className="flex min-w-0 flex-1 items-baseline gap-[6px] truncate">
          <span>{word}</span>
          {state.kind === "on" && <span data-api-port className="text-secondary tabular-nums text-text-soft-400">:{state.port}</span>}
        </span>
      )}
    </button>
  );
  const popover = (
    <Popover open={open} onOpenChange={setOpen} anchorRef={rowRef} side="top" align="start" offset={6} aria-label={t("sidebar.apiTitle")} className="w-[248px]">
      <div data-api-popover className="flex flex-col px-[14px] py-[10px]">
        <div className="flex min-h-[34px] items-center justify-between gap-2">
          <span className="text-ui text-text-strong-950">{t("sidebar.apiTitle")}</span>
          <span className="flex items-center gap-[6px] text-secondary text-text-sub-600">{dot}{word}</span>
        </div>
        {state.kind === "on" ? (
          <div data-api-address className="grid min-h-[34px] grid-cols-[56px_minmax(0,1fr)_24px] items-center gap-2 border-t border-stroke-soft-200">
            <span className="text-secondary text-text-soft-400">{t("sidebar.apiAddress")}</span>
            <span data-selectable className="truncate text-ui tabular-nums text-text-strong-950">{state.url}</span>
            <CopyButton size="3xsmall" label={t("details.copy", { label: t("sidebar.apiAddress") })} onCopy={copy} />
          </div>
        ) : (
          <p className="m-0 min-h-[34px] border-t border-stroke-soft-200 py-2 text-secondary text-text-soft-400">
            {state.kind === "off" ? t("sidebar.apiPopOff") : state.kind === "error" ? t("sidebar.apiPopError") : t("sidebar.apiPopStarting")}
          </p>
        )}
        {/* eslint-disable-next-line no-restricted-syntax -- a text link row in the popover */}
        <button
          type="button"
          data-api-settings
          onClick={() => { setOpen(false); openSettings("api", { focus: true }); }}
          className="mt-0.5 flex min-h-[34px] items-center border-t border-stroke-soft-200 text-left text-ui text-primary-text focus-ring"
        >
          {t("sidebar.apiSettingsLink")}
        </button>
      </div>
    </Popover>
  );
  if (compact) return <>{<Tooltip content={fullLabel} side="right">{row}</Tooltip>}{popover}</>;
  return (
    <>
      {/* The hairline sits directly above this row (owner, 2026-10-01). */}
      <div aria-hidden="true" className="mx-2 my-1.5 border-t border-stroke-soft-200" />
      <div className="flex items-center gap-1">
        <div className="group/api relative min-w-0 flex-1">
          {row}
          {state.kind === "on" && (
            <span data-api-copy className="invisible absolute inset-y-0 right-[2px] flex translate-x-1 items-center opacity-0 transition-[opacity,translate,visibility] duration-(--motion-base) ease-out group-hover/api:visible group-hover/api:translate-x-0 group-hover/api:opacity-100 group-focus-within/api:visible group-focus-within/api:translate-x-0 group-focus-within/api:opacity-100">
              <CopyButton size="3xsmall" label={t("details.copy", { label: t("sidebar.apiAddress") })} onCopy={copy} />
            </span>
          )}
        </div>
      </div>
      {popover}
    </>
  );
}

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/** Which space the launcher works in, the person's own or a team's, and the
 *  way to switch: always in view, the folded rail too (team initials there). */
function SpaceItem({ compact }: { compact: boolean }) {
  const t = useT();
  const st = useSpace((s) => s.state);
  const menu = useContextMenu();
  useEffect(() => { void useSpace.getState().load().catch(() => {}); }, []);
  const team = activeTeam(st);
  const onTeamPage = useNav((s) => s.section === "team");

  // A refusal is said, never lost: the team may have changed since the menu read it.
  // Re-read first, so the menu opened after the toast already shows why.
  const choose = async (space: Space, name: string) => {
    try {
      await useSpace.getState().choose(space);
    } catch (e) {
      await useSpace.getState().load().catch(() => {});
      toast.fail({ title: t("sidebar.spaceSwitchFailed", { name }), detail: teamError(e) });
    }
  };
  const drop = async (x: TeamLink, title: string) => {
    try {
      await useSpace.getState().leave(x.id);
    } catch (e) {
      toast.fail({ title, detail: teamError(e) });
    }
  };

  const leave = async () => {
    if (!team) return;
    const ok = await confirmModal({
      title: t("team.leaveTitle", { name: team.name }),
      // The admin token is shown once, when the server first starts: no invite brings its admin back.
      message: team.admin ? t("team.leaveAdminMessage") : t("team.leaveMessage"),
      confirmLabel: t("team.leaveConfirm"),
      danger: true,
    });
    if (ok) await drop(team, t("sidebar.spaceLeaveFailed", { name: team.name }));
  };

  // A team that withdrew this launcher cannot be worked in, only forgotten.
  const forget = async (x: TeamLink) => {
    const ok = await confirmModal({
      title: t("team.withdrawnTitle", { name: x.name }),
      message: t("team.withdrawnMessage"),
      confirmLabel: t("team.withdrawnForget"),
    });
    if (ok) await drop(x, t("sidebar.spaceForgetFailed", { name: x.name }));
  };

  // A team whose token its admin replaced waits for the new invite (Join opens with its address in),
  // or is forgotten when none is coming.
  const reinvite = async (x: TeamLink) => {
    const choice = await confirmModal({
      title: t("team.replacedTitle", { name: x.name }),
      message: t("team.replacedMessage"),
      buttons: [
        { label: t("confirm.cancel"), value: null },
        { label: t("team.withdrawnForget"), value: "forget" },
        { label: t("team.replacedPaste"), value: "paste", primary: true },
      ],
    });
    if (choice === "paste") requestAnimationFrame(() => useJoinTeam.getState().openFor(x.server));
    if (choice === "forget") await drop(x, t("sidebar.spaceForgetFailed", { name: x.name }));
  };

  const items: MenuItem[] = [
    { type: "radio", label: t("sidebar.spacePersonal"), checked: !team, onSelect: () => void choose(PERSONAL, t("sidebar.spacePersonal")) },
    ...(st?.teams ?? []).map((x): MenuItem => x.revoked
      ? { label: x.name, hint: t("sidebar.spaceWithdrawn"), onSelect: () => void forget(x) }
      : x.needs_invite
        ? { label: x.name, hint: t("sidebar.spaceNeedsInvite"), onSelect: () => void reinvite(x) }
        : {
            type: "radio",
            label: x.name,
            hint: hostOf(x.server),
            checked: team?.id === x.id,
            onSelect: () => void choose({ kind: "team", team_id: x.id }, x.name),
          }),
    { type: "separator" },
    // The team in hand: its page (its admin's tools, or a member's own access).
    ...(team ? [{ label: team.admin ? t("sidebar.spaceManage") : t("sidebar.spaceAccess"), onSelect: () => void useNav.getState().setSection("team") } as MenuItem] : []),
    // A frame later: the menu first gives the keyboard back to this row, where the dialog returns it.
    { label: t("sidebar.spaceJoin"), onSelect: () => requestAnimationFrame(() => useJoinTeam.getState().setOpen(true)) },
    { label: t("sidebar.spaceCreate"), onSelect: () => requestAnimationFrame(() => useCreateTeam.getState().setOpen(true)) },
    ...(team ? [{ type: "separator" } as MenuItem, { label: t("sidebar.spaceLeave"), danger: true, onSelect: () => void leave() } as MenuItem] : []),
  ];

  return (
    <>
      <NavItem
        size="small"
        data-nav="space"
        data-space={team ? "team" : "personal"}
        icon={team
          ? compact
            ? <span data-initials aria-hidden="true" className="text-micro text-text-sub-600">{initialsOf(team.name)}</span>
            : <SpaceTeamIcon className="size-3.5" />
          : <SpacePersonalIcon className="size-3.5" />}
        label={team?.name ?? t("sidebar.spacePersonal")}
        // Up and down: a switch between spaces, not a page.
        badge={<UnfoldMoreIcon aria-hidden="true" className="size-3.5 text-icon-soft-400" />}
        collapsed={compact}
        active={onTeamPage}
        aria-haspopup="menu"
        aria-description={t("sidebar.spaceSwitch")}
        onClick={(e) => menu.openFrom(e.currentTarget, items, { heading: t("sidebar.spaceHeading") })}
      />
      {menu.node}
      <JoinTeamHost />
      <CreateTeamHost />
    </>
  );
}

/** The launcher version; opens What's new and flags an available update. */
function VersionItem({ compact }: { compact: boolean }) {
  const t = useT();
  const openWhatsNew = useWhatsNew((s) => s.setOpen);
  const [info, setInfo] = useState<RtUpdate | null>(null);
  useEffect(() => {
    invoke<RtUpdate>("launcher_update_check").then(setInfo).catch(() => {});
  }, []);
  return (
    <NavItem
      size="small"
      // The app fetches What's new's code ahead when this is reached (App.tsx).
      data-nav="whats-new"
      icon={<span className="flex"><OctopusMini /></span>}
      label={t("sidebar.launcherVersion", { v: info?.current ?? "…" })}
      collapsed={compact}
      onClick={() => openWhatsNew(true)}
      badge={info?.update_available && <Badge color="warning" size="small">{t("sidebar.updateBadge")}</Badge>}
    />
  );
}

const moreBelow = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight > 1;

/// Scrolls the user-sized lists (Pinned, Folders, Views), and fades out at
/// the bottom while there is more below (LAYOUT-01: a half-cut row was the
/// only cue). The padding lives inside the scroller so focus rings are not
/// clipped at its edges; at the top it is a ring's room (its width and
/// offset) given back by a matching negative margin, so the first group's
/// New folder button, flush with the top, keeps its whole ring (owner).
function ScrollArea({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    const list = listRef.current;
    if (!el || !list) return;
    const read = () => setMore(moreBelow(el));
    read();
    el.addEventListener("scroll", read, { passive: true });
    // The box changes with the window; the list inside it whenever a group
    // folds, "Show more" opens or a Folder comes or goes.
    const ro = new ResizeObserver(read);
    ro.observe(el);
    ro.observe(list);
    return () => { el.removeEventListener("scroll", read); ro.disconnect(); };
  }, []);
  return (
    <div
      ref={ref}
      data-sidebar-scroll
      data-more-below={more || undefined}
      className="-mt-[calc(var(--focus-width)*2)] min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-[calc(var(--focus-width)*2)] pb-2 data-[more-below]:[mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]"
    >
      <div ref={listRef} className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

/** The sidebar's Tab stop before any item had focus: the current page's item. */
const currentItem = (items: HTMLElement[]) => items.find((el) => el.getAttribute("aria-current") === "page");

export function Sidebar() {
  const t = useT();
  const { rail: compact, byPeek } = useRailState();
  const team = useInTeam();
  const teamTrash = useTeamTrashShown();
  // One Tab stop for the whole sidebar, on the current page's item (A11Y-14:
  // 20 stops before the filter): the arrows, Home, End and a typed letter
  // move among its items, the folding group headings, their buttons and the
  // footer rows among them.
  const sidebar = useRef<HTMLElement>(null);
  useRovingFocus(sidebar, { selector: "nav button, [data-sidebar-footer] button", typeahead: true, initial: currentItem });
  // The key and the button act on what is drawn: opening a rail that Peek
  // folded holds only while that Peek is open; the next one folds it again.
  const toggle = () => {
    const prefs = useSidebarPrefs.getState();
    if (!compact) prefs.setRail(true);
    else {
      prefs.setRail(false);
      if (byPeek) prefs.setOverPeek(true);
    }
  };
  useRailKey(toggle);
  useEffect(() => {
    if (!byPeek && useSidebarPrefs.getState().overPeek) useSidebarPrefs.getState().setOverPeek(false);
  }, [byPeek]);

  return (
    <aside
      ref={sidebar}
      // F6 moves between this, the page header, the content and Peek (A11Y-14).
      data-region="sidebar"
      data-tour="sidebar"
      // Folded to its rail: items show no names (the tour's page-change beat
      // lights the page title instead).
      data-rail={compact || undefined}
      // A white panel on the gray ground, beside the page's (borderless,
      // owner 2026-10-01): no line between them.
      className={cn(
        "white-surface flex min-h-0 flex-col rounded-panel bg-bg-white-0",
        sidebarWidthClass(compact),
      )}
      // Shift+F10 or the Menu key on an item: its menu, under the item
      // (A11Y-13). macOS engines send no contextmenu for them.
      onKeyDown={(e) => {
        // Its own items only: an open menu's keys reach here through React too.
        const item = e.target instanceof HTMLElement && e.currentTarget.contains(e.target) ? e.target.closest<HTMLElement>("button") : null;
        if (!item || !isContextMenuKey(e.nativeEvent)) return;
        e.preventDefault();
        if (!e.repeat) openContextMenuFromKeys(item);
      }}
    >
      {/* Drags the window. The mark starts at the left, in line with the nav
          icons, on every system (the macOS traffic lights sit in the title
          strip above the panels). The fold button ends the row, in the
          column of the groups' own buttons; in the rail it is the row's only
          control, centered. */}
      <div
        className={cn(
          "flex h-[52px] shrink-0 items-center",
          compact ? "justify-center" : "pl-4 pr-2",
        )}
        onMouseDown={titleBarOnMouseDown}
      >
        {!compact && (
          <span data-brand className="flex items-center gap-2 text-ui font-bold text-text-strong-950">
            <span className="flex"><OctopusLogo /></span>
            <span>Octopus Agent</span>
          </span>
        )}
        {/* Not a Tab stop: the sidebar is one (A11Y-14), and this has its
            key (Mod+\), named in its tooltip and aria-keyshortcuts. */}
        <IconButton
          size="3xsmall"
          tabIndex={-1}
          className={cn(!compact && "ml-auto")}
          label={compact ? t("sidebar.expand") : t("sidebar.collapse")}
          tooltipSide={compact ? "right" : "bottom"}
          // Its key from the registry, in the tooltip (F8b).
          shortcut={capOf(command("app.toggleSidebar"))}
          aria-keyshortcuts={ariaOf(command("app.toggleSidebar"))}
          icon={<SidebarIcon className="size-3.5" />}
          onClick={toggle}
        />
      </div>

      <nav aria-label={t("sidebar.navLabel")} className="flex min-h-0 flex-1 flex-col">
        {/* Every visit's destinations, with no group label (plan ruling 16):
            never pushed down by the user's own lists (LAYOUT-01, CRAFT-16). */}
        <div data-sidebar-fixed className="flex shrink-0 flex-col gap-0.5 px-2 pb-3">
          <NavItem
            size="small"
            data-nav="search"
            data-tour="search"
            icon={<SearchIcon className="size-3.5" />}
            label={t("sidebar.search")}
            collapsed={compact}
            // The palette's key from the registry: a cap beside the word, and
            // in the rail's tooltip (PC-109).
            shortcut={capOf(command("app.palette"))}
            aria-keyshortcuts={ariaOf(command("app.palette"))}
            onClick={() => usePalette.getState().setOpen(true)}
            // The button declares the key (aria-keyshortcuts): the cap is
            // decoration, so its name is "Search", not "Search⌘K" (A11Y-09).
            badge={<Kbd aria-hidden="true">{capOf(command("app.palette"))}</Kbd>}
          />
          <AllProfilesItem compact={compact} />
          <PageItem id="proxies" label={t("sidebar.navProxies")} icon={<RouteIcon className="size-3.5" />} compact={compact} />
          <PageItem id="fingerprints" label={t("sidebar.navFingerprints")} icon={<NavFingerprintsIcon className="size-3.5" />} compact={compact} />
          <ExtensionsItem compact={compact} />
          <PageItem id="bookmarks" label={t("sidebar.navBookmarks")} icon={<NavBookmarksIcon className="size-3.5" />} compact={compact} />
          <PageItem id="automation" label={t("sidebar.navProjects")} icon={<NavAutomationIcon className="size-3.5" />} compact={compact} />
          <PageItem id="authenticator" label={t("sidebar.navAuthenticator")} icon={<AuthenticatorIcon className="size-3.5" />} compact={compact} />
        </div>
        {/* The lists that grow with the user's data scroll on their own. */}
        <ScrollArea>
          <PinnedGroup compact={compact} />
          {/* One box round Folders and Views, which the tour points at
              together; it keeps the list's own gap between the two. */}
          <div data-tour="views-folders" className="flex flex-col gap-3">
            <FoldersGroup compact={compact} />
            <ViewsGroup compact={compact} />
          </div>
        </ScrollArea>
      </nav>

      {/* No rule over the footer (borderless): the hairline above the API
          row is its one line. */}
      <div data-sidebar-footer className="flex shrink-0 flex-col gap-0.5 p-2">
        <SpaceItem compact={compact} />
        {/* In a team its Trash is the team's, for its admin and a member who sees rows in it. */}
        {(!team || teamTrash) && <PageItem id="trash" label={t("sidebar.navTrash")} icon={<NavTrashIcon className="size-3.5" />} compact={compact} />}
        <PageItem id="settings" label={t("sidebar.navSettings")} icon={<NavSettingsIcon className="size-3.5" />} compact={compact} />
        <VersionItem compact={compact} />
        <ApiStatus compact={compact} />
      </div>
    </aside>
  );
}

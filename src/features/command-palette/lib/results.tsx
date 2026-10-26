import { useEffect, useMemo } from "react";
import { ariaKeys, commandsOf, keyCaps, keyWorksOn, type Command, type CommandArea, type Subject } from "../../../shared/commands";
import { inLanguage, t, useLang } from "../../../shared/i18n";
import { FolderIcon, NavAutomationIcon, NavProxiesIcon } from "../../../shared/icons";
import { useNow } from "../../../shared/lib/useNow";
import { usePalette } from "../../../shared/model/palette";
import { useKeyPrefs } from "../../../shared/model/keyPrefs";
import { useNav } from "../../../shared/model/navigation";
import { confirmLeave } from "../../../shared/model/unsaved";
import { currentTheme } from "../../../shared/model/theme";
import type { Section } from "../../../shared/types";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { ViewIcon } from "../../../shared/ui/ViewIcon";
import {
  leaveList, profileStatus, searchTextOf, useAllViews, useFolders, useProfile, useProfileUi, useSaving, useViewCounts, viewName,
} from "../../../entities/profile";
import { tagsOf, useTags } from "../../../entities/tag";
import { useProxy } from "../../../entities/proxy";
import { useAutomation } from "../../../entities/automation";
import { useTrash } from "../../../entities/trash";
import { ariaOf, capOf, command, commandsFor, profileContext, proxyContext, reasonOf, runCommand, trashSelection } from "../../commands";
import type { PaletteGroup, PaletteItem } from "./match";

// Every icon in a 14 px slot (owner rule).
const ICON = "size-3.5";
const THEMES: Record<string, string> = { "app.themeLight": "light", "app.themeDark": "dark", "app.themeSystem": "system" };

/// The area a command's recent row names: Settings and Go to by their group,
/// the rest by the list or page they belong to.
/// A page reads as its name alone (the "{Area} / {name}" form is for objects),
/// and so does a command of the app itself.
function areaOf(c: Command): string | undefined {
  if (c.group === "navigate") return undefined;
  if (c.group === "settings") return t("palette.groupSettings");
  switch (c.area) {
    case "profiles": return t("palette.groupProfiles");
    case "proxies": return t("palette.areaProxies");
    case "trash": return t("palette.areaTrash");
    case "bookmarks": return t("palette.areaBookmarks");
    case "folders": return t("palette.groupFolders");
    default: return undefined;
  }
}

const groupOf = (c: Command): PaletteGroup =>
  c.group === "navigate" ? "pages" : c.group === "settings" ? "settings" : "actions";

/// A registry command as a palette row: its label (and its English one in
/// another language), its icon, and the key that does the same, printed only
/// on a page where that key works (the registry's page scope decides).
export function itemFromCommand(c: Command, lang: string, section: Section, extra?: Partial<PaletteItem>): PaletteItem {
  const Icon = c.icon;
  const keyed = keyWorksOn(c, section);
  const words = [...(c.keywords?.() ?? []), ...(lang === "en" ? [] : [inLanguage("en", () => c.label(1))])];
  return {
    id: `cmd:${c.id}`,
    commandId: c.id,
    group: groupOf(c),
    label: c.label(1),
    area: areaOf(c),
    keywords: words,
    // A key the Single-key shortcuts switch turned off is not printed (O14).
    keys: keyed && capOf(c) ? keyCaps(c.keys![0]) : undefined,
    aria: keyed ? ariaOf(c) : undefined,
    icon: Icon ? <Icon className={ICON} /> : undefined,
    hint: THEMES[c.id] && currentTheme() === THEMES[c.id] ? t("palette.current") : undefined,
    focusAfter: c.focusAfter,
    run: () => { void runCommand(c, { ids: [] }, { from: "palette" }); },
    ...extra,
  };
}

/// A result's actions (Tab or ArrowRight): the registry's commands for its
/// object, in menu order (run, open, organize, copy, danger), each printing
/// its key where that key works, one that cannot run now disabled with why.
export function actionItems(area: CommandArea, subject: Subject, lang: string): PaletteItem[] {
  const section = useNav.getState().section;
  return commandsFor("paletteActions", area, subject).map((c) => itemFromCommand(c, lang, section, {
    id: `act:${c.id}`,
    label: c.paletteLabel?.(subject) ?? c.label(subject.ids.length),
    disabled: reasonOf(c, subject) ?? undefined,
    run: () => { void runCommand(c, subject, { from: "paletteActions" }); },
  }));
}

/// The areas whose page and app commands the palette lists. Profiles first,
/// so New profile heads the actions with nothing typed, as it did before the
/// registry. Bookmarks for its New bookmark (C on its page).
const AREAS: CommandArea[] = ["profiles", "proxies", "trash", "bookmarks", "app"];

/** The page lists the context group acts on. */
const LIST_OF: Partial<Record<Section, CommandArea>> = { profiles: "profiles", proxies: "proxies", trash: "trash" };

/// Everything the palette lists: first what the page's list has (its
/// selection, else its active row), then one row per profile, the
/// registry's page and app commands, and one row per View and Folder.
/// `contextTitle` names the first group: "{n} selected" or the row's name.
export function usePaletteItems(): { items: PaletteItem[]; contextTitle: string | null } {
  const lang = useLang((s) => s.lang);
  const section = useNav((s) => s.section);
  // What the context group acts on; read inside the memo through the
  // registry's subjects, subscribed here so the group follows them.
  const selected = useProfileUi((s) => s.selected);
  const activeId = useProfileUi((s) => s.activeId);
  const activeByPointer = useProfileUi((s) => s.activeByPointer);
  const peekId = useProfileUi((s) => s.peekId);
  const proxySel = useProxy((s) => s.proxySel);
  const proxyActive = useProxy((s) => s.activeId);
  const proxyByPointer = useProxy((s) => s.activeByPointer);
  const proxyPeek = useProxy((s) => s.peekId);
  const proxyList = useProxy((s) => s.proxies);
  // The Trash's entries matter only on its page (its first group); elsewhere
  // a read of the Trash changes one flag, Empty Trash…'s (Pair 45 review, I2).
  const onTrash = section === "trash";
  const trashSel = useTrash((s) => (onTrash ? s.selected : null));
  const trashItems = useTrash((s) => (onTrash ? s.items : null));
  const trashEmpty = useTrash((s) => s.status === "ready" && s.items.length === 0);
  const anyRunning = useProfile((s) => Object.keys(s.running).length > 0);
  // The single keys print only while their switch is on (O14).
  const singleKeys = useKeyPrefs((s) => s.singleKeys);
  const profiles = useProfile((s) => s.profiles);
  const projects = useAutomation((s) => s.projects);
  const projectsStatus = useAutomation((s) => s.status);
  const paletteOpen = usePalette((s) => s.open);
  const proxies = useProfile((s) => s.proxies);
  const running = useProfile((s) => s.running);
  const startBusy = useProfile((s) => s.startBusy);
  const cancelled = useProfile((s) => s.cancelled);
  const pending = useProfile((s) => s.pending);
  const startFailed = useProfile((s) => s.startFailed);
  const saving = useSaving((s) => s.ids);
  const now = useNow();
  const tags = useTags((s) => s.tags);
  const byProfile = useTags((s) => s.byProfile);
  const folders = useFolders();
  const views = useAllViews();
  const viewCounts = useViewCounts(views);

  // Whether Empty Trash… can run reads the Trash: read again as the palette
  // opens, quietly, only when the copy may be out of date (older than 30 s,
  // or profiles moved in or out since), and again if a move lands while it
  // is open (a Cmd+K right after Delete). On the Trash the list is current.
  const trashStale = useTrash((s) => s.stale);
  useEffect(() => {
    if (useNav.getState().section !== "trash") void useTrash.getState().refresh();
  }, [trashStale]);

  // Automation projects load with their page: read them once for a search.
  useEffect(() => {
    if (paletteOpen && projectsStatus === "idle") void useAutomation.getState().init();
  }, [paletteOpen, projectsStatus]);

  // Four parts, each rebuilt only by what it shows, so a change to one (a
  // read of the Trash, a started profile) leaves the others' items, and the
  // scorer's words for them, as they were (Pair 45 review, I2).
  const context = useMemo(() => {
    // The first group acts on what the page's list has: its selection, else
    // the row the keyboard chose, else Peek's row, never one the pointer
    // only rests on (O7, IFACE-10; Pair 44 ruling). Keys print as the list's
    // menus print them; one that cannot run now is disabled with its reason
    // (EMIL-05). A run leaves the selection exactly as it was (owner rule).
    // On the Trash, with nothing picked, Restore and Delete for good still
    // show, disabled with why, so a search finds them (Pair 44 review, I2).
    const listArea = LIST_OF[section] ?? null;
    const subject = listArea === "profiles" ? profileContext()
      : listArea === "proxies" ? proxyContext()
      : listArea === "trash" ? trashSelection()
      : { ids: [] };
    const contextItems: PaletteItem[] = listArea && (subject.ids.length > 0 || listArea === "trash")
      ? commandsFor("palette", listArea, subject)
        .filter((c) => c.scope === "selection" || c.scope === "active")
        .map((c) => itemFromCommand(c, lang, section, {
          id: `ctx:${c.id}`,
          group: "context",
          label: c.paletteLabel?.(subject) ?? c.label(subject.ids.length),
          disabled: reasonOf(c, subject) ?? undefined,
          run: () => { void runCommand(c, subject, { from: "palette" }); },
        }))
      : [];
    const one = subject.ids.length === 1 ? subject.ids[0] : null;
    const contextTitle = subject.ids.length > 1 ? t("bulkActionsBar.selectedCount", { n: subject.ids.length })
      : one && listArea === "profiles" ? profiles.find((p) => p.id === one)?.name ?? null
      : one && listArea === "proxies" ? (() => { const x = proxyList.find((p) => p.id === one); return x ? x.name || `${x.host}:${x.port}` : null; })()
      : one && listArea === "trash" ? trashItems?.find((e) => e.id === one)?.name ?? null
      : listArea === "trash" ? t("trash.title")
      : null;
    return { contextItems, contextTitle };
    // The subjects are read through the registry; these subscriptions rebuild
    // the group when they change, and a command's `when` or reason with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, section, profiles, proxies, running, startBusy, pending, saving, selected, activeId, activeByPointer, peekId, proxySel, proxyActive, proxyByPointer, proxyPeek, proxyList, trashSel, trashItems]);

  const commandItems = useMemo(() => {
    // Page commands: featured on their own page, found by a search elsewhere.
    const commandItems = AREAS.flatMap((area) => commandsOf(area, "palette"))
      .filter((c) => (c.scope === "global" || c.scope === "page") && (!c.when || c.when({ ids: [] })))
      .map((c) => itemFromCommand(c, lang, section, {
        ...(c.scope === "page" && c.page !== section ? { featured: false } : {}),
        // Empty Trash… on an empty Trash says so (Pair 44 review, I2).
        disabled: reasonOf(c, { ids: [] }) ?? undefined,
      }));
    // One Change theme… lists the three themes (CRAFT-07: three rows took
    // three of seven action rows); a search still finds each by name.
    const themeItems = commandItems.filter((x) => THEMES[x.commandId ?? ""] !== undefined);
    for (const x of themeItems) x.featured = false;
    const changeTheme = commandItems.find((x) => x.commandId === "app.theme");
    if (changeTheme) {
      changeTheme.enterOpensActions = true;
      changeTheme.actions = () => themeItems.map((x) => ({ ...x, featured: true }));
    }
    return commandItems;
    // `when` and the reasons read the stores: Stop all by `anyRunning`, Empty
    // Trash… by `trashEmpty`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, section, anyRunning, trashEmpty, singleKeys]);

  const profileItems = useMemo(() => {
    const ui = () => useProfileUi.getState();
    // Pinned first: with nothing typed, the capped list starts with them.
    // One Map for the proxies' countries, not a `find` per profile.
    const countryOf = new Map(proxies.map((x) => [x.id, x.country]));
    const pinnedFirst = [...profiles.filter((p) => p.pinned), ...profiles.filter((p) => !p.pinned)];
    const profileItems: PaletteItem[] = pinnedFirst.map((p) => {
      const runningSince = running[p.id];
      const isRunning = runningSince !== undefined;
      // The same `profileStatus` the Profiles list and Peek use: one state,
      // one color, and every dot carries its word (owner rule: no dot alone),
      // idle's last-run text and "Never run" included.
      const status = profileStatus(p, {
        starting: startBusy.has(p.id), cancelled: cancelled.has(p.id), stopping: pending[p.id]?.kind === "stop", runningSince, failedAt: startFailed[p.id], saving: saving.has(p.id),
        now, lang, proxyMissing: !!p.proxy_id && p.origin !== "team" && !countryOf.has(p.proxy_id),
      });
      return {
        id: `profile:${p.id}`,
        profileId: p.id,
        group: "profiles",
        label: p.name,
        area: [t("palette.groupProfiles"), p.folder].filter(Boolean).join(" / "),
        // Name, notes and tag names, lowercased once (the list's search text), and the Folder.
        keywords: [p.folder, searchTextOf(p, tagsOf(p.id, { tags, byProfile }).map((x) => x.name))].filter(Boolean),
        // Two profiles that differ by a digit are told apart by where they
        // live (CRAFT-07): a comma and a space between the parts.
        subtitle: [p.folder, p.proxy_id ? countryOf.get(p.proxy_id) ?? "" : ""].filter(Boolean).join(", ") || undefined,
        meta: status.label,
        hint: isRunning ? t("palette.hintShow") : t("palette.start"),
        featured: p.pinned || isRunning,
        icon: (
          <span className="grid size-3.5 place-items-center">
            <StatusDot tone={status.dot} pulse={status.tone === "starting" || status.tone === "stopping"} halo={status.tone === "running"} />
          </span>
        ),
        // Enter starts an idle profile and shows a running one (a browser
        // window cannot be brought forward yet); Mod+Enter opens it in Peek,
        // the row shown first (O7).
        run: () => {
          if (isRunning) void ui().showInList(p.id);
          else void runCommand(command("profile.start"), { ids: [p.id] }, { from: "palette" });
        },
        runAlt: () => { void runCommand(command("profile.openPeek"), { ids: [p.id] }, { from: "palette" }); },
        // Show in list puts the keyboard on the row, Peek in Peek; Start runs at once.
        focusAfter: isRunning,
        focusAfterAlt: true,
        actions: () => actionItems("profiles", { ids: [p.id] }, lang),
      };
    });
    return profileItems;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, profiles, proxies, running, startBusy, cancelled, pending, startFailed, saving, now, tags, byProfile]);

  // Proxies and Automation projects, found by a search like profiles (at most
  // five each, ranked with the rest). Picking one opens it where it lives.
  const objectItems = useMemo(() => {
    const proxyItems: PaletteItem[] = proxies.map((x) => ({
      id: `proxy:${x.id}`,
      group: "proxies",
      label: x.name || `${x.host}:${x.port}`,
      area: t("palette.areaProxies"),
      subtitle: x.country || undefined,
      keywords: [x.host, String(x.port), x.kind, x.country, x.notes].filter(Boolean),
      featured: false,
      icon: <NavProxiesIcon className={ICON} />,
      // Opened only once the page changed: Cancel on unsaved changes stays put.
      run: async () => { if (await useNav.getState().setSection("proxies")) useProxy.getState().openPeek(x.id); },
    }));
    const projectItems: PaletteItem[] = projects.map((p) => ({
      id: `project:${p.id}`,
      group: "projects",
      label: p.name,
      area: t("palette.areaAutomation"),
      featured: false,
      icon: <NavAutomationIcon className={ICON} />,
      // Another project, while the open one has changes, asks first, as Back does.
      run: async () => {
        if (!(await useNav.getState().setSection("automation"))) return;
        if (useAutomation.getState().openId !== p.id && !(await confirmLeave())) return;
        useAutomation.getState().open(p.id);
      },
    }));
    return [...proxyItems, ...projectItems];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, proxies, projects]);

  const listItems = useMemo(() => {
    const ui = () => useProfileUi.getState();
    // The list gets the keyboard once the palette has closed (A11Y-04).
    const toProfiles = () => useNav.getState().setSection("profiles", { focus: true });
    const viewItems: PaletteItem[] = views.map((v) => ({
      id: `view:${v.id}`,
      group: "views",
      label: viewName(v, t),
      area: t("palette.groupViews"),
      keywords: v.builtin && lang !== "en" ? [inLanguage("en", () => viewName(v, t))] : [],
      hint: String(viewCounts[v.id] ?? ""),
      icon: <ViewIcon kind={v.icon} className={ICON} />,
      run: () => { void leaveList(() => { ui().applyView(v.id); void toProfiles(); }); },
    }));

    const folderItems: PaletteItem[] = folders.map((f, i) => ({
      id: `folder:${f}`,
      group: "folders",
      label: f,
      area: t("palette.groupFolders"),
      hint: String(profiles.filter((p) => p.folder === f).length),
      // Mod+1..9 open the first nine, in this order (nav.folders, useAppKeys).
      keys: i < 9 ? keyCaps(`Mod+${i + 1}`) : undefined,
      aria: i < 9 ? ariaKeys([`Mod+${i + 1}`]) : undefined,
      icon: <FolderIcon className={ICON} />,
      run: () => { void leaveList(() => { ui().setFolder(f); void toProfiles(); }); },
      // Open, Edit folder…, Delete folder…: a Folder's menu without a right-click (A11Y-13).
      actions: () => actionItems("folders", { ids: [f] }, lang),
    }));

    return [...viewItems, ...folderItems];
    // `t` and `inLanguage` follow `lang`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, profiles, folders, views, viewCounts]);

  return useMemo(() => ({
    items: [...context.contextItems, ...profileItems, ...objectItems, ...commandItems, ...listItems],
    contextTitle: context.contextTitle,
  }), [context, profileItems, objectItems, commandItems, listItems]);
}

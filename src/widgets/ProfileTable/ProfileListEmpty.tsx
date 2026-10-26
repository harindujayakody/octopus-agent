import { Button, EmptyState } from "@proxyshard/shardx-ui-kit";
import { FilterIcon, FolderIcon, SearchIcon, OctopusLogo } from "../../shared/icons";
import { useT } from "../../shared/i18n";
import { ViewIcon } from "../../shared/ui/ViewIcon";
import { refocusPageFilter } from "../../shared/lib/focus";
import { emptyFilters, leaveList, useCurrentView, useProfileUi, useViewModified, viewName } from "../../entities/profile";
import { activeTeam, useSpace } from "../../entities/space";
import { ImportProfilesButton, NewProfileButton } from "../../features/manage-profiles";

/// What the Profiles list says when it shows no rows, by what hid them: the
/// search, the View, the filters or the Folder. Each offers the way back:
/// only that (clearing the search leaves the filters, a View keeps its own).
export function ProfileListEmpty() {
  const t = useT();
  const search = useProfileUi((s) => s.search);
  const filters = useProfileUi((s) => s.filters);
  const folder = useProfileUi((s) => s.folder);
  const setSearch = useProfileUi((s) => s.setSearch);
  const clearFilters = useProfileUi((s) => s.clearFilters);
  const setFolder = useProfileUi((s) => s.setFolder);
  const resetView = useProfileUi((s) => s.resetView);
  const view = useCurrentView();
  const modified = useViewModified();
  const team = useSpace((s) => activeTeam(s.state));
  const unread = useSpace((s) => s.state?.team_status?.state !== undefined && s.state.team_status.state !== "ready" && !s.state.team_status.synced_at);

  if (search.trim()) {
    return (
      <EmptyState
        icon={<SearchIcon />}
        title={t("profileTable.noMatchTitle", { q: search.trim() })}
        actions={<Button variant="neutral" mode="stroke" size="xsmall" onClick={() => { setSearch(""); refocusPageFilter(); }}>{t("listStates.clearSearch")}</Button>}
      />
    );
  }
  if (view) {
    return (
      <EmptyState
        icon={<ViewIcon kind={view.icon} />}
        title={t("profileTable.viewEmptyTitle", { name: viewName(view, t) })}
        hint={t("profileTable.viewEmptyHint")}
        actions={
          <>
            {modified && <Button variant="neutral" mode="stroke" size="xsmall" onClick={resetView}>{t("viewBar.reset")}</Button>}
            <Button variant="neutral" mode="stroke" size="xsmall" onClick={() => void leaveList(() => setFolder("all"))}>{t("sidebar.allProfiles")}</Button>
          </>
        }
      />
    );
  }
  const base = emptyFilters();
  if ((Object.keys(base) as (keyof typeof base)[]).some((k) => filters[k] !== base[k])) {
    return (
      <EmptyState
        icon={<FilterIcon />}
        title={t("profileTable.filtersNoMatchTitle")}
        actions={<Button variant="neutral" mode="stroke" size="xsmall" onClick={clearFilters}>{t("listStates.clearFilters")}</Button>}
      />
    );
  }
  // A team's server that never answered gave nothing to list yet (the banner says why).
  if (team && unread) {
    return (
      <EmptyState
        icon={<span className="grid"><OctopusLogo size={21} /></span>}
        title={t("profileTable.teamUnreadTitle")}
        hint={t("profileTable.teamUnreadHint")}
      />
    );
  }
  // A team's member sees only what its admin shows them: an empty list says so.
  const member = !!team && !team.admin;
  if (folder !== "all") {
    return (
      <EmptyState
        icon={<FolderIcon />}
        title={t("profileTable.folderEmptyTitle", { folder })}
        hint={member ? t("profileTable.teamEmptyHint") : t("profileTable.folderEmptyHint")}
        actions={<NewProfileButton />}
      />
    );
  }
  if (member) {
    return (
      <EmptyState
        icon={<span className="grid"><OctopusLogo size={21} /></span>}
        title={t("profileTable.teamEmptyTitle")}
        hint={t("profileTable.teamEmptyHint")}
        actions={<><NewProfileButton /><ImportProfilesButton /></>}
      />
    );
  }
  return (
    <EmptyState
      // The brand mark is 21 px, the same as the kit EmptyState draws its icons.
      icon={<span className="grid"><OctopusLogo size={21} /></span>}
      title={t("profileTable.emptyTitle")}
      hint={t("profileTable.emptyHint")}
      // The page's main action is the filled primary button, first, as on every
      // empty page; both buttons keep their tooltips and the registry's key.
      actions={<><NewProfileButton /><ImportProfilesButton /></>}
    />
  );
}

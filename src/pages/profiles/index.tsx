import { countActiveFilters, useCurrentView, useListTotal, useProfileUi, useVisibleProfiles, viewName } from "../../entities/profile";
import { ViewBar } from "../../features/manage-views";
import { ProfileFilterChips } from "../../features/manage-profiles";
import { useFirstRun } from "../../features/onboarding";
import { useProfile } from "../../entities/profile";
import { useT } from "../../shared/i18n";
import { PageBody, PageHeader } from "../../widgets/PageHeader";
import { ProfileBulkBar } from "../../widgets/ProfileBulkBar";
import { ProfileToolbar } from "../../widgets/ProfileTable/ProfileToolbar";
import { ProfileTable } from "../../widgets/ProfileTable/ProfileTable";
import { ProfilePeek } from "../../widgets/ProfilePeek";
import { useHeldLoading } from "../../shared/hooks/useHeldLoading";
import { ListColumn } from "../../shared/ui/ListColumn";
import { showMeAround } from "../../features/tour";

// Profile data and process polling are loaded by the app shell (App.tsx):
// the sidebar needs them on every page.
export function ProfilesPage() {
  const t = useT();
  const search = useProfileUi((s) => s.search);
  const setSearch = useProfileUi((s) => s.setSearch);
  const folder = useProfileUi((s) => s.folder);
  const view = useCurrentView();
  const visible = useVisibleProfiles();
  const filters = useProfileUi((s) => s.filters);
  const total = useListTotal();
  // "3 of 8" while a search, a problem card's chip, or outside a View a
  // filter, narrows the list.
  const only = useProfileUi((s) => s.only !== null);
  const narrowed = search.trim() !== "" || only || (!view && countActiveFilters(filters) > 0);
  const hasProfiles = useProfile((s) => s.profiles.length > 0);
  const status = useProfile((s) => s.status);
  useFirstRun();
  // The table's placeholder rows wait 150 ms and stay 400 ms (WIG-12). Held
  // here, above the table: the table mounts with this page.
  const loading = useHeldLoading(status === "idle" || status === "loading");
  // Follows the held value, so the header controls and the placeholder rows
  // give way together, not up to 400 ms apart. No profiles at all: nothing
  // to filter, count or arrange (LAYOUT-20). Not while a search or filters
  // narrow it: the empty state names them and the header keeps the field and
  // the menu that clear them, as Proxies.
  const empty = !loading && status === "ready" && !hasProfiles && !narrowed;

  return (
    <>
      <PageHeader
        title={view ? viewName(view, t) : folder === "all" ? t("profiles.allTitle") : folder}
        count={!loading && status === "ready" && !empty ? (narrowed ? { shown: visible.length, total } : visible.length) : undefined}
        help={{ title: t("pageHelp.profiles.title"), body: t("pageHelp.profiles.body"), onTour: () => showMeAround("profiles") }}
        after={<ViewBar />}
        filter={empty ? undefined : { value: search, onChange: setSearch }}
        actions={<ProfileToolbar empty={empty} />}
      />
      <PageBody scroll={false} className="relative">
        {/* Peek always pushes the list: it never lies over it. */}
        <div data-list-row className="relative flex min-h-0 flex-1 gap-panel">
          {/* The list's own column: its bar and the toasts stay off Peek (F2). */}
          <ListColumn>
            {/* The applied filters, each removable (O8); nothing while none
                applies. In the list's column, so Peek starts under the page
                header as every Peek does (LAYOUT-12). */}
            <ProfileFilterChips />
            {/* Before the list in Tab order; it floats over the list's bottom edge. */}
            <ProfileBulkBar />
            <ProfileTable loading={loading} />
          </ListColumn>
          <ProfilePeek />
        </div>
      </PageBody>
    </>
  );
}

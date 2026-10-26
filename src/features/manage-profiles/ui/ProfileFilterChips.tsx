import { countActiveFilters, useCurrentView, useProfileUi, useViewFilters, viewName } from "../../../entities/profile";
import { useT } from "../../../shared/i18n";
import { FilterChips } from "../../../shared/ui/filters";
import { useProfileFilterChips } from "../lib/filterFields";

/// The Profiles chips row: the filters a person added, and Clear. Inside a
/// View that filters by something itself, a locked label ("View: Running")
/// stands before them in place of chips: the View's own filters are part of
/// it, so they cannot be taken off here, and Clear leaves them. "Save as
/// view…" is not here: it has one place, the header's actions group
/// (SaveAsViewButton).
export function ProfileFilterChips() {
  const t = useT();
  const chips = useProfileFilterChips();
  const clearFilters = useProfileUi((s) => s.clearFilters);
  const view = useCurrentView();
  const own = useViewFilters();
  const lock = view && own && countActiveFilters(own) > 0 ? t("filters.viewLock", { name: viewName(view, t) }) : null;
  return <FilterChips chips={chips} lock={lock} onClear={clearFilters} />;
}

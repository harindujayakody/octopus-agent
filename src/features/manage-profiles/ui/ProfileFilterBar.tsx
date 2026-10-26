import { useState } from "react";
import { Button } from "@proxyshard/shardx-ui-kit";
import { countActiveFilters, useCurrentView, useProfileUi, useViewFilters } from "../../../entities/profile";
import { FilterMenu } from "../../../shared/ui/filters";
import { useT } from "../../../shared/i18n";
import { useProfileFilterFields } from "../lib/filterFields";

/** Filters for the Profiles list (O8): a field, then a value with its count. The order is in Display.
 *  A field the open custom View sets is greyed with its reason, and the menu
 *  offers Edit view, the way to change it. */
export function ProfileFilterBar() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const filters = useProfileUi((s) => s.filters);
  const fields = useProfileFilterFields(open);
  const view = useCurrentView();
  const own = useViewFilters();
  const editView = useProfileUi((s) => s.editView);
  // Locked fields exist only in a View with own filters, not being edited; a built-in cannot be edited.
  const footer = view && !view.builtin && own && countActiveFilters(own) > 0 ? (
    <div className="flex px-[8px] pb-[6px]">
      <Button variant="neutral" mode="ghost" size="3xsmall" onClick={() => { setOpen(false); editView(view.id); }}>{t("commands.editView")}</Button>
    </div>
  ) : undefined;
  return <FilterMenu open={open} onOpenChange={setOpen} fields={fields} activeCount={countActiveFilters(filters)} label={t("profileFilterBar.filters")} footer={footer} />;
}

import { useId, useRef, useState } from "react";
import { Button, Checkbox, Popover, Tooltip } from "@proxyshard/shardx-ui-kit";
import { DisplayIcon } from "../../../shared/icons";
import { SelectField } from "../../../shared/ui/SelectField";
import { PROFILE_COLUMNS, useProfileLayout, useProfileUi, type ProfileSort } from "../../../entities/profile";
import { columnChoices, defaultSet, isDefaultSet, setShown } from "../../../shared/lib/tableColumns";
import { useT } from "../../../shared/i18n";

/** How the list shows its rows: their order and the columns. Filters decide which rows. */
export function ProfileDisplayMenu() {
  const t = useT();
  const sort = useProfileUi((s) => s.sort);
  const setSort = useProfileUi((s) => s.setSort);
  const columns = useProfileUi((s) => s.columns);
  const setColumns = useProfileUi((s) => s.setColumns);
  const layout = useProfileLayout();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  // The same list, in the same order and state, as the list header's column
  // menus (owner feature 2026-09-26): one function builds both.
  const choices = columnChoices(PROFILE_COLUMNS, columns, layout, t, (id) => (id === "tags" ? t("tableColumns.noTags") : t("tableColumns.inFolder")));
  const changed = sort !== "added" || !isDefaultSet(PROFILE_COLUMNS, columns);

  return (
    <>
      {/* Its word in a tooltip only while a narrow header shows its icon alone. */}
      <Tooltip content={t("profileDisplay.title")} whenTruncated>
        <Button
          ref={trigger}
          variant="neutral"
          mode="stroke"
          size="xsmall"
          leftIcon={<DisplayIcon className="size-3.5" />}
          // Says, and shows, that its panel is open (UI-28, A11Y-06).
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {t("profileDisplay.title")}
        </Button>
      </Tooltip>

      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={trigger}
        align="end"
        aria-label={t("profileDisplay.title")}
        className="flex w-[240px] flex-col gap-3 p-3"
      >
        <SelectField
          label={t("profileFilterBar.orderTitle")}
          value={sort}
          onChange={(v) => setSort(v as ProfileSort)}
          options={[
            { value: "added", label: t("profileFilterBar.orderAdded") },
            { value: "name-asc", label: t("profileFilterBar.orderNameAsc") },
            { value: "name-desc", label: t("profileFilterBar.orderNameDesc") },
            { value: "created-desc", label: t("profileFilterBar.orderNewest") },
            { value: "created-asc", label: t("profileFilterBar.orderOldest") },
            { value: "launched-desc", label: t("profileFilterBar.orderLaunched") },
            { value: "runtime-desc", label: t("profileFilterBar.orderRuntime") },
            { value: "status", label: t("profileFilterBar.orderStatus") },
          ]}
        />
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-section-title text-text-strong-950">{t("profileDisplay.columns")}</legend>
          {choices.map((c) => (
            // A note that does not fit beside the label drops under it, flush right: never over the label.
            <div key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <Checkbox
                wrapperClassName="min-w-0 grow"
                label={c.title}
                checked={c.checked}
                disabled={c.disabled}
                aria-describedby={c.note ? `${noteId}-${c.id}` : undefined}
                onChange={(e) => setColumns(setShown(PROFILE_COLUMNS, columns, c.id, e.target.checked))}
              />
              {c.note && <span id={`${noteId}-${c.id}`} data-column-note className="ms-auto min-w-0 text-end text-secondary text-text-soft-400">{c.note}</span>}
            </div>
          ))}
        </fieldset>
        {changed && (
          <Button variant="neutral" mode="ghost" size="2xsmall" className="self-start" data-display-reset onClick={() => { setSort("added"); setColumns(defaultSet(PROFILE_COLUMNS)); }}>
            {t("profileDisplay.reset")}
          </Button>
        )}
      </Popover>
    </>
  );
}

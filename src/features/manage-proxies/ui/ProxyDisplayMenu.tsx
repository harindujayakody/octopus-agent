import { useId, useRef, useState } from "react";
import { Button, Checkbox, Popover, Tooltip } from "@proxyshard/shardx-ui-kit";
import { DisplayIcon } from "../../../shared/icons";
import { SelectField } from "../../../shared/ui/SelectField";
import { PROXY_COLUMNS, useProxy, useProxyColumns, useProxyLayout, type ProxySort } from "../../../entities/proxy";
import { columnChoices, defaultSet, isDefaultSet, setShown } from "../../../shared/lib/tableColumns";
import { useT } from "../../../shared/i18n";

/** How the Proxies list shows its rows: their order and the columns (O8). The
 *  columns come from the same `columnChoices` as the list header's menus, so
 *  both say the same and both are saved. */
export function ProxyDisplayMenu() {
  const t = useT();
  const sort = useProxy((s) => s.sort);
  const setSort = useProxy((s) => s.setSort);
  const columns = useProxyColumns((s) => s.columns);
  const setColumns = useProxyColumns((s) => s.setColumns);
  const layout = useProxyLayout();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const choices = columnChoices(PROXY_COLUMNS, columns, layout, t);
  const changed = sort !== "added" || !isDefaultSet(PROXY_COLUMNS, columns);

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
          onChange={(v) => setSort(v as ProxySort)}
          options={[
            { value: "added", label: t("profileFilterBar.orderAdded") },
            { value: "name", label: t("proxyDisplay.orderName") },
            { value: "latency", label: t("proxyDisplay.orderLatency") },
            { value: "tested", label: t("proxyDisplay.orderTested") },
            { value: "profiles", label: t("proxyDisplay.orderProfiles") },
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
                onChange={(e) => setColumns(setShown(PROXY_COLUMNS, columns, c.id, e.target.checked))}
              />
              {c.note && <span id={`${noteId}-${c.id}`} data-column-note className="ms-auto min-w-0 text-end text-secondary text-text-soft-400">{c.note}</span>}
            </div>
          ))}
        </fieldset>
        {changed && (
          <Button variant="neutral" mode="ghost" size="2xsmall" className="self-start" data-display-reset onClick={() => { setSort("added"); setColumns(defaultSet(PROXY_COLUMNS)); }}>
            {t("profileDisplay.reset")}
          </Button>
        )}
      </Popover>
    </>
  );
}

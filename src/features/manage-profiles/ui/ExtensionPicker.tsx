import { useEffect, useMemo, useState } from "react";
import { Button, Combobox, IconButton, Tooltip, cn } from "@proxyshard/shardx-ui-kit";
import { ChevronDownIcon, CloseIcon } from "../../../shared/icons";
import { canUpdate, extensionName, iconSrc, useExtensionUpdates, useExtensions, type ExtensionEntry } from "../../../entities/extension";
import { useNav } from "../../../shared/model/navigation";
import { useT } from "../../../shared/i18n";

function Icon({ e, className }: { e: ExtensionEntry; className?: string }) {
  const src = iconSrc(e.icon);
  return src ? (
    <img src={src} alt="" className={cn("shrink-0 rounded-chip-sm outline outline-1 -outline-offset-1 outline-stroke-image", className)} />
  ) : (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-chip-sm bg-bg-weak-50 text-micro",
        className,
      )}
    >
      {/* Its initial, written as a capital, not a CSS transform. */}
      {extensionName(e).slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Which extensions this profile loads. Expanded in place, not in a popover:
 *  the editor sits in a table row that clips an overlay. `listOnly` is the
 *  list alone, open, for a popover that is already its frame (Peek's
 *  Extensions row): the chips and the toggle would be a second step there. */
export function ExtensionPicker({
  value, onChange, listOnly = false,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  listOnly?: boolean;
}) {
  const t = useT();
  const items = useExtensions((s) => s.items);
  const init = useExtensions((s) => s.init);
  const updates = useExtensionUpdates((s) => s.byId);
  const go = useNav((s) => s.setSection);
  const [open, setOpen] = useState(false);

  useEffect(() => { init(); }, [init]);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  const picked = useMemo(
    () => value.map((id) => items.find((e) => e.id === id)).filter(Boolean) as ExtensionEntry[],
    [value, items],
  );
  if (items.length === 0) {
    return (
      <p className={cn("m-0 text-secondary text-text-soft-400", listOnly && "p-3")}>
        {t("extensionPicker.emptyLibrary")}{" "}
        <Button mode="link" size="3xsmall" onClick={() => go("extensions")}>
          {t("extensionPicker.addOne")}
        </Button>
      </p>
    );
  }

  // One search field over the list (IFACE-04): typing filters, the arrows
  // move one highlight, Enter adds or removes the extension, the pointer
  // toggles a whole row (FEEL-25).
  const list = (
    <Combobox
      multiple
      aria-label={t("extensionPicker.label")}
      placeholder={t("extensionPicker.searchPlaceholder")}
      options={items.map((e) => ({
        value: e.id,
        label: extensionName(e),
        // An update the Web Store offers, in words beside the version (never a dot alone).
        hint: canUpdate(updates[e.id]) ? t("extensionPicker.updateHint", { version: e.version }) : e.version || undefined,
        keywords: [e.description],
        icon: <Icon e={e} className="size-3.5" />,
      }))}
      value={value}
      onChange={(id) => toggle(id)}
      emptyText={t("extensionPicker.noMatches")}
      maxListHeight={176}
    />
  );
  // In a popover, the popover is its frame; inline, it gets one of its own.
  if (listOnly) return list;

  return (
    <div className="flex flex-col gap-1.5">
      {picked.length > 0 && (
        <div className="flex max-h-[88px] flex-wrap gap-1.5 overflow-y-auto scrollbar">
          {picked.map((e) => (
            <span
              key={e.id}
              className="flex max-w-[13rem] items-center gap-1.5 rounded-chip bg-bg-selected py-1 pl-1 pr-1 text-secondary text-primary-text"
            >
              <Icon e={e} className="size-3.5" />
              <Tooltip content={e.description || extensionName(e)}>
                <span className="truncate">{extensionName(e)}</span>
              </Tooltip>
              <IconButton
                size="3xsmall"
                variant="primary"
                className="size-3.5"
                icon={<CloseIcon className="size-3.5" />}
                label={t("extensionPicker.removeTitle")}
                onClick={() => toggle(e.id)}
              />
            </span>
          ))}
        </div>
      )}

      <Button
        variant="neutral"
        mode="stroke"
        size="3xsmall"
        className="w-fit"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        rightIcon={<ChevronDownIcon className={cn("size-3.5 transition-transform duration-(--motion-base) ease-out reduced:transition-none", open && "rotate-180")} />}
      >
        {picked.length > 0
          ? t("extensionPicker.changeCount", { n: picked.length, total: items.length })
          : t("extensionPicker.choose")}
      </Button>

      {open && (
        <div className="tile">
          {list}
        </div>
      )}
    </div>
  );
}

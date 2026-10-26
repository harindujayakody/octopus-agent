import { useRef, useState, type ReactNode } from "react";
import { Button, IconButton, Menu, Tooltip, type MenuItem } from "@proxyshard/shardx-ui-kit";
import { ChevronDownIcon, MoreIcon } from "../../shared/icons";
import { useT } from "../../shared/i18n";

/// A page header's menu (F4, LAYOUT-06). By default the one `…` button that
/// holds every secondary action of the page; with a labeled `trigger`, a
/// filled primary that opens a short list of ways to do one thing (Add
/// extension: from a link, a file, a folder).
export function HeaderMenu({ items, label, trigger = "more", tour }: {
  items: MenuItem[];
  label?: string;
  trigger?: "more" | { label: string; icon?: ReactNode };
  /** The tour's key for a labeled trigger (`data-tour`). */
  tour?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (items.length === 0) return null;
  const name = trigger === "more" ? (label ?? t("pageHeader.more")) : trigger.label;
  return (
    <>
      {trigger === "more" ? (
        <IconButton
          ref={anchor}
          label={name}
          icon={<MoreIcon className="size-3.5" />}
          mode="stroke"
          size="xsmall"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        />
      ) : (
        // Its words in a tooltip only while a narrow header shows its icon alone.
        <Tooltip content={trigger.label} whenTruncated>
          <Button
            ref={anchor}
            variant="primary"
            mode="filled"
            size="xsmall"
            leftIcon={trigger.icon}
            rightIcon={<ChevronDownIcon className="size-3.5" />}
            data-tour={tour}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {trigger.label}
          </Button>
        </Tooltip>
      )}
      <Menu open={open} onOpenChange={setOpen} anchor={anchor} align="end" aria-label={name} items={items} />
    </>
  );
}

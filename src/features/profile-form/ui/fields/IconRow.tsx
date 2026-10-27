import { useRef, useState } from "react";
import { Button, IconButton, Popover, cn } from "@proxyshard/shardx-ui-kit";
import { PropertyButton, PropertyRow } from "../../../../shared/ui/peek";
import { ProfileIcon, SITE_ICONS, siteIcon } from "../../../../shared/brands";
import { useT } from "../../../../shared/i18n";

/// A profile's icon as a property row: the site it is for (Facebook,
/// Pinterest…), shown before its name in the list so a glance finds it. It
/// opens a grid of site icons in place; None leaves the name alone. "" is
/// none.
export function IconRow({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const current = siteIcon(value);
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <PropertyRow id="icon" label={t("profileForm.icon")}>
      {(labelId) => (
        <>
          <PropertyButton ref={anchor} labelledBy={labelId} expanded={open} empty={!current} onClick={() => setOpen((v) => !v)}>
            {current && <ProfileIcon id={current.id} />}
            <span className="truncate">{current ? current.title : t("profileForm.iconNone")}</span>
          </PropertyButton>
          <Popover open={open} onOpenChange={setOpen} anchorRef={anchor} align="start" aria-label={t("profileForm.icon")} className="w-[264px] p-2">
            <div data-icon-grid role="group" aria-label={t("profileForm.icon")} className="grid grid-cols-7 gap-1">
              {SITE_ICONS.map((s) => (
                <IconButton
                  key={s.id}
                  data-icon-option={s.id}
                  label={s.title}
                  icon={<ProfileIcon id={s.id} size={16} />}
                  size="xsmall"
                  tooltipWarm={false}
                  aria-pressed={value === s.id}
                  className={cn(value === s.id && "bg-bg-weak-50 ring-1 ring-inset ring-primary-base")}
                  onClick={() => pick(s.id)}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-end">
              <Button variant="neutral" mode="ghost" size="xsmall" disabled={!value} onClick={() => pick("")}>
                {t("profileForm.iconClear")}
              </Button>
            </div>
          </Popover>
        </>
      )}
    </PropertyRow>
  );
}

import { useEffect, useState } from "react";
import {
  helperFields, helperFill, helperClose, helperDismiss, type HelperField,
} from "../../entities/profile/model/api";
import { Button, IconButton } from "@proxyshard/shardx-ui-kit";
import { CloseIcon } from "../../shared/icons";
import { FloatingPanel } from "../../shared/ui/FloatingPanel";
import { useT } from "../../shared/i18n";
import { hasOwn } from "../../shared/lib/utils";

/**
 * Shard Helper: offers to fill a form the browser noticed. It only ever offers —
 * nothing is typed until the button is pressed — and closes itself once the page
 * has nothing left to fill.
 */
export function HelperPanel({ profile }: { profile: string }) {
  const t = useT();
  const [fields, setFields] = useState<HelperField[]>([]);
  const [busy, setBusy] = useState(false);
  const [filled, setFilled] = useState(0);

  useEffect(() => {
    let alive = true;
    let last = "";
    const tick = async () => {
      try {
        const r = await helperFields(profile);
        if (!alive) return;
        const next = r?.fields ?? [];
        // Unchanged: nothing to draw (PERF-23).
        const json = JSON.stringify(next);
        if (json !== last) { last = json; setFields(next); }
        // Nothing left to fill — the page moved on, or the browser closed.
        if (next.length === 0) void helperClose();
      } catch { void helperClose(); }
    };
    void tick();
    const id = setInterval(tick, 1200);
    return () => { alive = false; clearInterval(id); };
  }, [profile]);

  /** What a kind is called to a person. */
  const LABELS: Record<string, string> = {
    first_name: t("helperPanel.firstName"), last_name: t("helperPanel.lastName"),
    full_name: t("helperPanel.fullName"),
    email: t("helperPanel.email"), username: t("helperPanel.username"),
    phone: t("helperPanel.phone"), country: t("helperPanel.country"), city: t("helperPanel.city"),
    postal_code: t("helperPanel.postcode"), street: t("helperPanel.address"),
    birth_day: t("helperPanel.birthDay"), birth_month: t("helperPanel.birthMonth"),
    birth_year: t("helperPanel.birthYear"),
    birth_date: t("helperPanel.birthDate"), gender: t("helperPanel.gender"),
  };

  const kinds = [...new Set(fields.map((f) => f.kind))];

  return (
    <FloatingPanel
      title={t("helperPanel.title")}
      actions={
        <IconButton
          size="3xsmall"
          icon={<CloseIcon className="size-3.5" />}
          label={t("helperPanel.dismiss")}
          tooltipSide="bottom"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => void helperDismiss(profile)}
        />
      }
    >

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-1">
        {/* In a group each window fills with its own person. */}
        <div className="flex flex-wrap gap-1">
          {kinds.map((k) => (
            <span key={k}
                  className="rounded-chip px-1.5 py-0.5 text-secondary text-text-sub-600 ring-1 ring-inset ring-stroke-soft-200">
              {hasOwn(LABELS, k) ? LABELS[k] : k}
            </span>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-3 pb-3 pt-1">
        <Button
          size="2xsmall"
          className="w-full"
          onMouseDown={(e) => e.stopPropagation()}
          disabled={busy || fields.length === 0}
          onClick={async () => {
            setBusy(true);
            try { setFilled(await helperFill(profile)); } catch { /* shown by the next poll */ }
            setBusy(false);
          }}
        >
          {filled > 1
            ? t("helperPanel.filledWindows", { n: filled })
            : filled === 1
              ? t("helperPanel.fillAgain")
              : fields.length === 1
                ? t("helperPanel.fillOneField")
                : t("helperPanel.fillFields", { n: fields.length })}
        </Button>
      </div>
    </FloatingPanel>
  );
}

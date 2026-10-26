import { useLayoutEffect, useRef } from "react";
import { Button, usePresence } from "@proxyshard/shardx-ui-kit";
import { SpinnerIcon } from "../../shared/icons";
import { useT } from "../../shared/i18n";

/// The bar at the bottom of the Settings page while anything is unsaved
/// (manual save, owner 2026-10-07): the words "Unsaved changes", Don't save
/// and Save. It sits under the page, not over it, so it never covers a row;
/// it is a raised layer with no ring and no colored edge, rising in and
/// out as the bulk bar does (UI-24). A save that failed says why beside the
/// buttons, in words, and a field that cannot be saved yet (a port that is
/// not a number) holds Save and says so the same way.
export function SaveBar({ dirty, saving, error, held, onSave, onDiscard }: {
  dirty: boolean;
  saving: boolean;
  /** Why the last save failed. */
  error: string | null;
  /** Why Save waits: a field shows text that is not a value yet. */
  held: string | null;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const t = useT();
  // The words stay through the exit, so nothing changes while it fades.
  const presence = usePresence(dirty ? { error, held } : null, { maxExitMs: 200 });
  const hadFocus = useRef(false);

  // Focus inside the bar when it closes (Save by keyboard) goes back to the
  // open section's tab: the leaving bar is inert, so it would fall to the page.
  useLayoutEffect(() => {
    if (dirty || !hadFocus.current) return;
    hadFocus.current = false;
    document.querySelector<HTMLElement>("[role='tab'][aria-selected='true']")?.focus();
  }, [dirty]);

  if (!presence.mounted || !presence.value) return null;
  const { ref, ...rootProps } = presence.rootProps;
  const note = presence.value.error ?? presence.value.held;
  return (
    <div className="pointer-events-none flex shrink-0 justify-center px-gutter pb-3">
      <div
        ref={ref}
        role="group"
        aria-label={t("settings.unsaved")}
        data-save-bar
        data-tour="settings-save"
        {...rootProps}
        onFocus={() => { hadFocus.current = true; }}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hadFocus.current = false; }}
        // A raised layer: the float shadow, no ring (borderless, owner
        // 2026-10-01); forced colors keep a system edge. 35 px like the bulk
        // bar, taller only when the words wrap in a narrow window.
        className={
          "pointer-events-auto flex min-h-[35px] max-w-full items-center gap-1 rounded-surface bg-bg-raised py-[5px] pr-1.5 pl-3 shadow-(--shadow-float) forced-edge white-surface " +
          "transition-[opacity,translate] duration-(--motion-base) ease-out " +
          "data-starting-style:translate-y-(--motion-shift) data-starting-style:opacity-0 " +
          "data-ending-style:translate-y-(--motion-nudge) data-ending-style:opacity-0 data-ending-style:duration-(--motion-fast)"
        }
      >
        <span className="mr-1.5 min-w-0 text-secondary text-text-strong-950">
          <span className="font-medium">{t("settings.unsaved")}</span>
          {note && <span role="alert" data-save-bar-note className="ml-2 text-error-text">{note}</span>}
        </span>
        <Button size="2xsmall" variant="neutral" mode="ghost" disabled={saving} onClick={onDiscard}>
          {t("unsaved.dontSave")}
        </Button>
        <Button
          size="2xsmall"
          isLoading={saving}
          // The word stays beside the spinner while it saves.
          leftIcon={saving ? <SpinnerIcon aria-hidden="true" className="size-3.5" /> : undefined}
          disabled={held != null}
          onClick={onSave}
        >
          {saving ? t("settings.saving") : t("unsaved.save")}
        </Button>
      </div>
    </div>
  );
}

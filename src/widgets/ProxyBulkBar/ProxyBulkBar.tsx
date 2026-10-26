import { IconButton, useLatched } from "@proxyshard/shardx-ui-kit";
import { CloseIcon } from "../../shared/icons";
import { useProxy, useSelectedVisibleProxies } from "../../entities/proxy";
import { useT } from "../../shared/i18n";
import { focusProxyRow } from "../../shared/lib/focusRow";
import { BulkBarFrame } from "../../shared/ui/BulkBarFrame";
import { CommandButton, ariaOf, barCommands, capOf } from "../../features/commands";
import { command } from "../../shared/commands";

/// The Proxies selection bar, floating at the bottom of the list column as on
/// Profiles: Test, Assign to profiles, Export, Delete, from the command
/// registry (E4). It counts and acts on the selected proxies the list shows.
export function ProxyBulkBar() {
  const t = useT();
  const shown = useSelectedVisibleProxies();
  const count = shown.length;
  const clearSelected = useProxy((s) => s.clearSelected);
  // Through its exit it keeps the selection it showed (no button dims while it fades).
  const subject = useLatched(count > 0 ? { ids: shown.map((p) => p.id) } : null) ?? { ids: [] };
  const clear = command("proxy.clearSelection");
  // The count it showed stays through the exit, not "0 selected".
  const label = useLatched(count > 0 ? t("bulkActionsBar.selectedCount", { n: count }) : null) ?? "";
  return (
    <BulkBarFrame
      open={count > 0}
      label={label}
      onClosedWithFocus={() => focusProxyRow(useProxy.getState().activeId, { ifLost: true, orTabbable: true })}
    >
      {(narrow) => (
        <>
          <span className="mr-1.5 text-secondary font-medium text-text-strong-950 tabular-nums">{label}</span>
          {barCommands("proxies").map((c) => (
            <CommandButton key={c.id} command={c} subject={subject} from="bulkBar" narrow={narrow} />
          ))}
          <IconButton
            label={clear.label(count)}
            shortcut={capOf(clear)}
            aria-keyshortcuts={ariaOf(clear)}
            icon={<CloseIcon className="size-3.5" />}
            size="3xsmall"
            onClick={clearSelected}
          />
        </>
      )}
    </BulkBarFrame>
  );
}

import { Button, Tooltip } from "@proxyshard/shardx-ui-kit";
import { AddIcon } from "../../../shared/icons";
import { keyWorksOn } from "../../../shared/commands";
import { useNav } from "../../../shared/model/navigation";
import { useProxy } from "../../../entities/proxy";
import { capOf, command, labelOf, reasonOf } from "../../commands";
import { useRightsChange } from "../../../entities/space";

/// The registry's Add proxies: its words, and its key (C) in the tooltip,
/// shown only on a page where C works (Proxies), as New profile's.
export function NewProxyButton({ className }: { className?: string }) {
  const setBulkOpen = useProxy((s) => s.setBulkOpen);
  const section = useNav((s) => s.section);
  const cmd = command("proxy.new");
  const label = labelOf("proxy.new");
  // A team without Create for this person: the button says why and does nothing.
  useRightsChange();
  const why = reasonOf(cmd, { ids: [] });
  return (
    <Tooltip content={why ?? label} shortcut={!why && keyWorksOn(cmd, section) ? capOf(cmd) : undefined}>
      <Button
        variant="primary"
        mode="filled"
        size="xsmall"
        className={className}
        data-tour="add-proxy"
        leftIcon={<AddIcon className="size-3.5" />}
        disabled={!!why}
        aria-description={why ?? undefined}
        onClick={() => { if (!why) setBulkOpen(true); }}
      >
        {/* The palette's words for the same command (one name per command). */}
        {label}
      </Button>
    </Tooltip>
  );
}

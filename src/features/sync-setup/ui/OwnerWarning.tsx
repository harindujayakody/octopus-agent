import { Button } from "@proxyshard/shardx-ui-kit";
import { AlertIcon } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";
import { useCreateTeam } from "../../create-team";

/// Plainly, before connecting: whoever runs a server the person does not can
/// read what is stored there. Their own server is one guide away.
export function OwnerWarning({ text }: { text: string }) {
  const t = useT();
  return (
    <p data-sync-owner="other" className="m-0 flex items-start gap-1.5 text-help text-text-strong-950">
      <AlertIcon className="mt-px size-3.5 shrink-0 text-warning-base" />
      <span>
        {text}{" "}
        <Button mode="link" variant="primary" size="3xsmall" className="text-help underline" onClick={() => useCreateTeam.getState().setOpen(true, "sync")}>
          {t("sync.setUpOwn")}
        </Button>
      </span>
    </p>
  );
}

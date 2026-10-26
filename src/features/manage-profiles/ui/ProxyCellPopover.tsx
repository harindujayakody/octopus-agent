import { Button, Popover } from "@proxyshard/shardx-ui-kit";
import { useProfile, type ProfileMeta } from "../../../entities/profile";
import { teamRefusal, useRightsChange } from "../../../entities/space";
import { useT } from "../../../shared/i18n";
import { AddIcon } from "../../../shared/icons";
import { openProfileForm } from "../../profile-form/model/useProfileForm";
import { toast } from "../../../shared/model/toast";
import { ProxyPicker } from "./ProxyPicker";

/// The proxy of one profile, picked in a popover under its cell: a search
/// the keyboard finishes (IFACE-04). Choosing binds at once, closes it and
/// says it saved: the pick is the press, so it needs no Save of its own.
/// "Add a new proxy" at its foot opens the profile's form on its Proxy tab,
/// where a proxy is added with the rest of the profile's changes.
export function ProxyCellPopover({ open, profile, anchorRef, onClose }: {
  open: boolean;
  profile: ProfileMeta;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const t = useT();
  const proxies = useProfile((s) => s.proxies);
  const bindProxy = useProfile((s) => s.bindProxy);
  useRightsChange();
  const noCreate = !!teamRefusal("create");
  return (
    <Popover
      open={open}
      onOpenChange={(open) => { if (!open) onClose(); }}
      anchorRef={anchorRef}
      align="start"
      aria-label={t("profileRow.proxyLabel")}
      // The Combobox draws its own insets.
      className="w-[320px] p-0"
    >
      <ProxyPicker
        value={profile.proxy_id}
        proxies={proxies}
        onPick={(id) => {
          onClose();
          if (id !== profile.proxy_id) void bindProxy(profile.id, id).then((ok) => { if (ok) toast.saved(t("cellEdit.saved", { name: profile.name })); });
        }}
      />
      {/* A team's new proxy needs Create on it (doors.rs InlineProxy). */}
      {!noCreate && (
        <div className="p-1">
          <Button
            variant="neutral" mode="ghost" size="3xsmall" contentAlign="start" className="w-full"
            leftIcon={<AddIcon className="size-3.5" />}
            onClick={() => { onClose(); openProfileForm({ mode: "edit", id: profile.id, tab: "proxy" }); }}
          >
            {t("profileForm.addNewProxy")}
          </Button>
        </div>
      )}
    </Popover>
  );
}

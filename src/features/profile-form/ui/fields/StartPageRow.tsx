import { Input } from "@proxyshard/shardx-ui-kit";
import { PropertyRow } from "../../../../shared/ui/peek";
import { useT } from "../../../../shared/i18n";

/// The page this profile opens on when it starts, over Settings' start page.
/// Empty follows Settings; an address without https:// is taken as one.
export function StartPageRow({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const t = useT();
  return (
    <PropertyRow id="start-page" label={t("profileForm.startPage")}>
      {(labelId) => (
        <Input
          inputSize="xsmall"
          wrapperClassName="min-w-0 flex-1"
          aria-labelledby={labelId}
          placeholder={t("profileForm.startPagePlaceholder")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </PropertyRow>
  );
}

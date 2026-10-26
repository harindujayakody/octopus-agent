import { SegmentControl } from "@proxyshard/shardx-ui-kit";
import { OS_OPTIONS } from "../../../../shared/constants";
import { useT } from "../../../../shared/i18n";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import type { FingerprintPick } from "./useFingerprintPick";

export function OsField({ pick }: { pick: FingerprintPick }) {
  const t = useT();
  return (
    <FieldGroup label={t("inlineEditor.osLabel")}>
      {(labelId) => (
        <SegmentControl
          aria-labelledby={labelId}
          size="xsmall"
          className="w-full *:flex-1"
          value={pick.osFilter}
          items={OS_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
          onChange={pick.pickOs}
        />
      )}
    </FieldGroup>
  );
}

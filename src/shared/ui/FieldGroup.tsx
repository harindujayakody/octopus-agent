import { useId, type ReactNode } from "react";
import { Label } from "@proxyshard/shardx-ui-kit";

/// A caption over a control that is not a text field (a segment picker). A
/// <label> there passes a click on the caption to the first segment and
/// changes the value (WIG-01); this caption only names the group. `children`
/// gets the caption's id, for the control's aria-labelledby.
export function FieldGroup({ label, children }: { label: string; children: (labelId: string) => ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-[6px]">
      <Label as="span" id={id}>{label}</Label>
      {children(id)}
    </div>
  );
}

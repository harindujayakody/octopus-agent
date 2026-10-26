import { Input } from "@proxyshard/shardx-ui-kit";
import type { FieldProps } from "../types";

/// Labelled text field — UI-kit Input with the app's simple onChange API.
export function Field({ label, value, onChange, type = "text", placeholder, mono, secret, error }: FieldProps) {
  return (
    <Input
      label={label}
      inputSize="xsmall"
      type={type}
      value={value}
      placeholder={placeholder}
      className={mono ? "mono" : undefined}
      wrapperClassName="gap-[6px]"
      onChange={(e) => onChange(e.target.value)}
      secret={secret}
      error={error}
    />
  );
}

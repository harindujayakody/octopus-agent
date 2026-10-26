import { Select, type SelectOption } from "@proxyshard/shardx-ui-kit";
import type { ReactNode } from "react";
import { useT } from "../i18n";

export type SelectFieldOption<T extends string | number> = {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Renders instead of the plain label (e.g. a tinted chip); `label` still
   *  drives search and naming. Fix round 1 (I1). */
  content?: ReactNode;
  disabled?: boolean;
  /** Secondary text at the end of the row and the field (host:port), kept
   *  whole where the label is cut (TYPE-07). */
  hint?: string;
  /** A fact that is never cut ("Not encrypted"): a badge at the end of the
   *  row and the field; the label gives way first. */
  badge?: SelectOption["badge"];
};

/// Options straight from a list of values, labelled by `format` (or the value itself).
export const optionsOf = <T extends string | number>(
  values: readonly T[],
  format?: (v: T) => string,
): SelectFieldOption<T>[] => values.map((v) => ({ value: v, label: format ? format(v) : String(v) }));

/// The app's one dropdown: the kit Select with typed (string or number) values.
export function SelectField<T extends string | number>({
  label, value, options, onChange, placeholder, isSearchable, searchPlaceholder, size = "xsmall", disabled, ...aria
}: {
  label?: string;
  value: T;
  options: SelectFieldOption<T>[];
  onChange: (v: T) => void;
  placeholder?: string;
  /** Filter box inside the dropdown. Worth it past a dozen options. */
  isSearchable?: boolean;
  searchPlaceholder?: string;
  size?: "xsmall" | "small" | "medium";
  disabled?: boolean;
  /** Names the field when there is no visible `label`. */
  "aria-label"?: string;
  /** The id of a visible caption that names it instead (a setting row's title). */
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const t = useT();
  const byKey = new Map(options.map((o) => [String(o.value), o.value]));
  return (
    <Select
      noResultsText={t("common.noResults")}
      size={size}
      className="gap-[6px]"
      label={label}
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"]}
      aria-describedby={aria["aria-describedby"]}
      value={String(value)}
      placeholder={placeholder}
      disabled={disabled}
      isSearchable={isSearchable}
      searchPlaceholder={searchPlaceholder}
      options={options.map((o) => ({ value: String(o.value), label: o.label, icon: o.icon, content: o.content, disabled: o.disabled, hint: o.hint, badge: o.badge }))}
      onChange={(v) => {
        const next = byKey.get(v);
        if (next !== undefined) onChange(next);
      }}
    />
  );
}

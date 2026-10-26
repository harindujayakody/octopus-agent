import type { ReactNode } from "react";

/** One value a filter field can take, with how many rows it would list.
 *  `content` renders in place of the icon and label (a tag's own chip);
 *  `label` still names it and is what the search matches. */
export type FilterValue = {
  value: string;
  label: string;
  count?: number;
  icon?: ReactNode;
  content?: ReactNode;
  keywords?: string[];
};

/** One field of the Filters menu: Status, Tag, Country… `current` is null
 *  when it does not narrow the list; `set(null)` takes it off. */
export type FilterField = {
  id: string;
  label: string;
  icon?: ReactNode;
  values: FilterValue[];
  current: string | null;
  set: (value: string | null) => void;
  /** The list's own View sets this field: it shows its value but cannot be
   *  changed here (edit the View to change it). */
  locked?: boolean;
};

/** An applied filter as a removable chip under the header. `id` is its
 *  field's id. */
export type FilterChip = { id: string; label: string; onRemove: () => void };

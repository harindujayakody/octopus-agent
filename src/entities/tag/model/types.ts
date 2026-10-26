import type { LabelColorId } from "../../../shared/constants";

/// A label on profiles: many per profile, colored from the Folder palette.
export type Tag = { id: string; name: string; color: LabelColorId };

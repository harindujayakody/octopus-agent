import type { TagColor } from "../../../shared/constants";

/// A label on profiles: many per profile, colored from the Folder palette or
/// with a custom "#rrggbb".
export type Tag = { id: string; name: string; color: TagColor };

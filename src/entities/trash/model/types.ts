export type TrashEntry = {
  id: string;
  name: string;
  folder: string;
  /** Unix seconds. */
  deleted_at: number;
  /** Unix seconds; the sweep at startup removes anything past it. */
  expires_at: number;
  size_bytes: number;
};

export type Bookmark = {
  id: string;
  title: string;
  url: string;
  /** Launcher folder this belongs to; empty means every profile. */
  folder: string;
};

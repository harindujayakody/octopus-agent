export type Bookmark = {
  id: string;
  title: string;
  url: string;
  /** Launcher folder this belongs to; empty means every profile. */
  folder: string;
  /** The bookmark set it is in ("Facebook"…); profiles take the sets they pick. Absent or "": none. */
  set?: string;
};

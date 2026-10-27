import { invoke } from "../../shared/api/invoke";

/** A Firefox add-on of the library (firefox_addons.rs `Addon`). */
export type FirefoxAddon = {
  /** Its Gecko id, as "uBlock0@raymondhill.net". */
  id: string;
  name: string;
  version: string;
  /** The addons.mozilla.org page it came from, "" for a file. */
  source: string;
  added_at: number;
};

export const firefoxAddonList = () => invoke<FirefoxAddon[]>("firefox_addon_list");
/** An addons.mozilla.org link, slug or add-on id. */
export const firefoxAddonImportUrl = (url: string) => invoke<FirefoxAddon>("firefox_addon_import_url", { url });
/** A signed .xpi on disk. */
export const firefoxAddonImportFile = (path: string) => invoke<FirefoxAddon>("firefox_addon_import_file", { path });
export const firefoxAddonDelete = (id: string) => invoke<void>("firefox_addon_delete", { id });

import { invoke } from "../../../shared/api/invoke";
import type { ExtensionEntry, ExtensionImport, ExtensionUpdate, InProfileExtension, LinkResult, UpdateResult } from "./types";

export const extensionList = () => invoke<ExtensionEntry[]>("extension_list");
/** The extensions the personal profiles installed inside their browsers (extensions.rs `in_profiles`). */
export const extensionsInProfiles = () => invoke<InProfileExtension[]>("extensions_in_profiles");
/** Takes .crx, .zip or unpacked folders; returns what went in and each file refused.
 *  `separate`: a copy beside one the library holds already. */
export const extensionImport = (paths: string[], separate = false) =>
  invoke<ExtensionImport>("extension_import", { paths, separate });
/** Web Store link, a bare extension id, or a direct .crx / .zip URL. */
export const extensionImportUrl = (url: string, separate = false) =>
  invoke<ExtensionEntry>("extension_import_url", { url, separate });
export const extensionDelete = (id: string) => invoke("extension_delete", { id });

// ---- Updates from the Web Store ----

/** What is known now, from disk, with no request. */
export const extensionUpdates = () => invoke<ExtensionUpdate[]>("extension_updates");
/** Asks the Web Store now (a check under way is waited for). */
export const extensionUpdatesCheck = () => invoke<ExtensionUpdate[]>("extension_updates_check");
/** `confirmed` lets in what the staged version asked about. */
export const extensionUpdate = (id: string, confirmed = false) =>
  invoke<UpdateResult>("extension_update", { id, confirmed });
export const extensionLinkSource = (id: string, link: string, confirmed = false) =>
  invoke<LinkResult>("extension_link_source", { id, link, confirmed });
export const extensionUpdateCancel = (id: string) => invoke<void>("extension_update_cancel", { id });
export const extensionUpdateSkip = (id: string, version: string) => invoke<void>("extension_update_skip", { id, version });

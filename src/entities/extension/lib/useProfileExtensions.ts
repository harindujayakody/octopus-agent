import { create } from "zustand";
import { extensionImport, extensionImportUrl, extensionsInProfiles } from "../model/api";
import type { InProfileExtension } from "../model/types";
import { useExtensions } from "./useExtensions";

type State = {
  status: "idle" | "loading" | "ready" | "error";
  items: InProfileExtension[];
  error: string | null;
  /** Extensions being added to the library now, by id. */
  adding: Record<string, boolean>;
};

/// The extensions profiles installed by themselves, inside their browsers
/// (the Web Store, Firefox's add-ons site), read from their folders. Read
/// each time the Extensions page shows them: a profile may have added one
/// since.
export const useProfileExtensions = create<State>(() => ({ status: "idle", items: [], error: null, adding: {} }));

export async function loadProfileExtensions(): Promise<void> {
  useProfileExtensions.setState({ status: "loading", error: null });
  try {
    useProfileExtensions.setState({ items: await extensionsInProfiles(), status: "ready" });
  } catch (e) {
    useProfileExtensions.setState({ status: "error", error: String(e instanceof Error ? e.message : e) });
  }
}

/// Puts a Chrome extension a profile installed into the library: from the Web
/// Store by its id, so it keeps its updates; one the store does not have (a
/// developer's, a removed one) is copied from the profile's folder instead.
export async function addProfileExtensionToLibrary(x: InProfileExtension): Promise<void> {
  useProfileExtensions.setState((s) => ({ adding: { ...s.adding, [x.ext_id]: true } }));
  try {
    try {
      await extensionImportUrl(x.ext_id);
    } catch {
      const got = await extensionImport([x.path]);
      if (got.added.length === 0) throw new Error(got.refused[0]?.error ?? "not added");
    }
    await useExtensions.getState().reload();
  } finally {
    useProfileExtensions.setState((s) => ({ adding: { ...s.adding, [x.ext_id]: false } }));
  }
}

import { create } from "zustand";

/// Team and synced profiles whose browser has closed while their session is still being sent
/// (open.rs keeps them in `team_sessions` until it is): "Saving…", and Start waits for it.
/// Filled by features/team-sessions `watchSaving`.
export const useSaving = create<{ ids: ReadonlySet<string> }>(() => ({ ids: new Set<string>() }));

/** Whether the profile's session is still being sent from here. */
export const isSaving = (id: string): boolean => useSaving.getState().ids.has(id);

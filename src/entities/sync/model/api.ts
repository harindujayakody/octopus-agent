import { invoke } from "@tauri-apps/api/core";
import type { SyncCommand, SyncCommands } from "./types";

/** One sync command, typed by its name. A refusal rejects with the backend's words. */
export function syncCall<K extends SyncCommand>(cmd: K, args: SyncCommands[K]["args"]): Promise<SyncCommands[K]["result"]> {
  return invoke<SyncCommands[K]["result"]>(cmd, args);
}

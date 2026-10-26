import { invoke } from "@tauri-apps/api/core";
import type { TeamCommand, TeamCommands } from "./types";

/** One team command, typed by its name. A refusal rejects with the backend's words. */
export function teamCall<K extends TeamCommand>(cmd: K, args: TeamCommands[K]["args"]): Promise<TeamCommands[K]["result"]> {
  return invoke<TeamCommands[K]["result"]>(cmd, args);
}

import { invoke } from "@tauri-apps/api/core";
import type { RtStatus } from "../../shared/types";

// Its own module, apart from the gate: the launcher entry calls it before the
// launcher's code is in, and an entry that imported the gate would make every
// panel window load the gate, the sidebar and the profile store (PERF-24).

type StatusAnswer = { status: RtStatus } | { error: string };
const askStatus = (): Promise<StatusAnswer> =>
  invoke<RtStatus>("runtime_status").then((status) => ({ status }), (e: unknown) => ({ error: String(e) }));
/** The engine check asked as the bundle loads (`askEngineEarly`), for the
 *  gate's first run to take. */
let early: Promise<StatusAnswer> | null = null;

/// The launcher asks the engine question as its bundle loads, beside React's
/// first render rather than after it: the window shows only its frame until
/// the answer is in (first paint). The gate's first run takes this answer;
/// any later run (the tree rebuilt in another language) asks again.
export function askEngineEarly(): void {
  if ("__TAURI_INTERNALS__" in window) early = askStatus();
}

/** The early answer once, then a fresh question each time. */
export function engineAnswer(): Promise<StatusAnswer> {
  const asked = early ?? askStatus();
  early = null;
  return asked;
}

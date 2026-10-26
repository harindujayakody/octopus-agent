import { invoke } from "@tauri-apps/api/core";

/** This computer's monitor: width and height in CSS pixels, and its pixel ratio. */
export type HostScreen = [number, number, number];

/// This computer's monitor (lib.rs `host_screen`); null on a machine with
/// none, or when it could not be asked.
export function hostScreen(): Promise<HostScreen | null> {
  return invoke<HostScreen | null>("host_screen").then((v) => v ?? null, () => null);
}

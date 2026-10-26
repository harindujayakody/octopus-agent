import { useEffect } from "react";
import { create } from "zustand";
import { gpuCaps, gpuCompat } from "../../entities/fingerprint/model/api";
import type { GpuCompat, HostGlCaps } from "../../entities/fingerprint/model/types";

/// Which library fingerprints this machine can wear without contradicting itself.
///
/// The core replaces the WebGL extension list with the profile's, but it cannot
/// make an extension work. A profile listing one the driver does not have gives
/// the page a list that says yes and a getExtension() that returns null — a
/// contradiction two calls wide, and the first thing a serious anti-fraud check
/// looks for in a rewritten list.
///
/// Loaded once per app run. The first call is slow (the engine is started
/// off-screen to be asked), so nothing waits on it: the verdict arrives and the
/// badges appear.
const WARN_OFF_KEY = "shardx.gpuCompat.suppressWarning";

type State = {
  caps: HostGlCaps | null;
  byId: Record<string, GpuCompat>;
  loaded: boolean;
  loading: boolean;
  /// The user asked not to be warned again on this machine. Kept in local
  /// storage rather than in the profile store on purpose: it is a fact about
  /// this operator's patience on this box, not about any profile.
  suppressed: boolean;
  load: () => Promise<void>;
  setSuppressed: (v: boolean) => void;
  /// undefined when the verdict is not known — the caller must not read that
  /// as "compatible".
  verdict: (id: string) => GpuCompat | undefined;
};

export const useGpuCompat = create<State>((set, get) => ({
  caps: null,
  byId: {},
  loaded: false,
  loading: false,
  suppressed: (() => { try { return localStorage.getItem(WARN_OFF_KEY) === "1"; } catch { return false; } })(),

  load: async () => {
    if (get().loading || get().loaded) return;
    set({ loading: true });
    try {
      const [caps, byId] = await Promise.all([gpuCaps(false), gpuCompat()]);
      set({ caps, byId, loaded: true });
    } catch {
      // A machine where the probe cannot run keeps working, just without
      // verdicts. Silence is deliberate: a toast on every app start would
      // train the user to dismiss it.
      set({ loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  setSuppressed: (v) => {
    try { localStorage.setItem(WARN_OFF_KEY, v ? "1" : "0"); } catch { /* private mode: until reload */ }
    set({ suppressed: v });
  },

  verdict: (id) => get().byId[id],
}));

/// Ask for the verdicts from anywhere that shows a fingerprint.
///
/// Safe to call from every card: the store refuses a second load while one is
/// in flight and after one has finished, so the cost is one probe per app run
/// no matter how many components ask. Having each consumer ask is what keeps a
/// new surface from silently showing no badges because somebody forgot to wire
/// the load in the page above it — which is exactly what happened first.
export function useGpuCompatReady() {
  const load = useGpuCompat((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
}

/** How long anything waits for the verdicts: the check starts the engine and can
 *  hang (no display, no GPU), so past this the caller goes on without them. */
export const VERDICT_WAIT_MS = 1000;

/** Loads this machine's GPU verdicts, waiting at most `limitMs`; true when they are in. */
export function verdictsLoaded(limitMs = VERDICT_WAIT_MS): Promise<boolean> {
  void useGpuCompat.getState().load();
  if (useGpuCompat.getState().loaded) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const done = (inTime: boolean) => { clearTimeout(timer); stop(); resolve(inTime); };
    const timer = setTimeout(() => done(false), limitMs);
    const stop = useGpuCompat.subscribe((s) => { if (s.loaded) done(true); });
  });
}

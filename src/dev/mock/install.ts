// In-browser stand-in for Tauri's IPC bridge. Loaded before the app entry by
// the Vite plugin in vite.config.ts when VITE_MOCK=1, so `invoke` and `listen`
// from @tauri-apps/api resolve here instead of at a Rust process.
//
// Contract implemented (what @tauri-apps/api/core and /event actually call):
//   window.__TAURI_INTERNALS__.invoke(cmd, args, options)
//   window.__TAURI_INTERNALS__.transformCallback(cb, once) -> id
//   window.__TAURI_INTERNALS__.unregisterCallback(id)
//   window.__TAURI_INTERNALS__.metadata.currentWindow / currentWebview
//   window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, id)
//   invoke("plugin:event|listen", { event, handler }) -> id
//   invoke("plugin:event|unlisten", { event, eventId })
//   invoke("plugin:event|emit", { event, payload })
import { handlers, type Ctx } from "./handlers";
import { loadState, resetState, saveState, sleep } from "./store";
import { bindSync } from "./syncServer";
import { mirror, moveSpace, refusal, setTeamStatus, settle, spaceEpoch, withdraw } from "./spaces";
import { setLease, setMyGrants, teamDoor, teamView } from "./teamRights";
import { savedElsewhere } from "./teamProjects";
import { sessionEnded, sessionResent } from "./teamSessions";
import { addTeamTrash, type MockTrashRow } from "./teamTrash";
import type { SessionOutcome } from "../../entities/space/model/sessions";
import type { Grant } from "../../entities/team/model/types";
import type { TeamStatus } from "../../entities/space/model/types";
import { toast } from "../../shared/model/toast";

type Callback = (payload: unknown) => void;

/** Commands the app polls every second or so, plus the OS clipboard (a local
 *  call, never a backend round trip): no latency for these. A secret's
 *  clipboard-clear timer (SEC-11) races a real setTimeout against the fake
 *  clock a test installs with page.clock, so the read/write it depends on
 *  must settle before the test advances the clock. Tag and folder writes land
 *  at once too: a reload right after one finds it, as in the app. */
const FAST = new Set([
  "process_list", "helper_profiles", "automation_run_status", "automation_fleet", "sync_status",
  "plugin:event|listen", "plugin:event|unlisten", "plugin:event|emit", "clipboard_write", "clipboard_read",
  "tag_save", "tag_delete", "tag_assign", "tag_import", "folder_add", "folder_meta_set", "folder_import",
]);

function install(): void {
  if ("__TAURI_INTERNALS__" in window) return;

  let state = loadState();
  let nextCallbackId = 1;
  let pending = 0;
  // Window commands (minimize, start_dragging, …) in call order, for tests.
  const windowCalls: string[] = [];
  // The same calls with their arguments (the theme a window was asked for).
  const windowArgs: { cmd: string; args: unknown }[] = [];
  // How many times each command ran, for tests that count backend round trips.
  const calls: Record<string, number> = {};
  // Every command with its arguments, oldest first (the last 5,000), for tests of call order.
  const log: { cmd: string; args: Record<string, unknown> }[] = [];
  const callbacks = new Map<number, { cb: Callback; once: boolean }>();
  const listeners = new Map<string, Set<number>>();

  const emit = (event: string, payload?: unknown) => {
    const ids = listeners.get(event);
    if (!ids) return;
    for (const id of ids) {
      const entry = callbacks.get(id);
      if (!entry) continue;
      try { entry.cb({ event, id, payload }); } catch (e) { console.error("[mock] listener threw", event, e); }
      if (entry.once) { callbacks.delete(id); ids.delete(id); }
    }
  };

  const ctx: Ctx = {
    get state() { return state; },
    save: () => saveState(state),
    emit,
  };
  bindSync(() => state, emit, () => saveState(state));

  const events: Record<string, (args: any) => unknown> = {
    "plugin:event|listen": ({ event, handler }) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(Number(handler));
      return Number(handler);
    },
    "plugin:event|unlisten": ({ event, eventId }) => { listeners.get(event)?.delete(Number(eventId)); callbacks.delete(Number(eventId)); return null; },
    "plugin:event|emit": ({ event, payload }) => { emit(event, payload); return null; },
    "plugin:event|emit_to": ({ event, payload }) => { emit(event, payload); return null; },
  };

  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const fn: ((a: any, c: Ctx) => unknown) | undefined = events[cmd] ?? handlers[cmd];
    if (!fn) {
      if (cmd.startsWith("plugin:window|")) { windowCalls.push(cmd); windowArgs.push({ cmd, args }); return null; }
      if (cmd.startsWith("plugin:webview|")) return null;
      console.warn(`[mock] no handler for "${cmd}"`, args);
      return null;
    }
    calls[cmd] = (calls[cmd] ?? 0) + 1;
    log.push({ cmd, args }); if (log.length > 5000) log.shift();
    // `window.__shardxMockFail = { cmd: n }`: the next n calls of cmd fail.
    const fails = (window as { __shardxMockFail?: Record<string, number> }).__shardxMockFail;
    if (fails?.[cmd]) {
      fails[cmd]--;
      // `window.__shardxMockFailAfter = { cmd: ms }`: such a failure comes
      // after ms, as a call that fails on its way (a save still in flight).
      const after = (window as { __shardxMockFailAfter?: Record<string, number> }).__shardxMockFailAfter?.[cmd];
      if (after) await sleep(after);
      throw `Mock failure: ${cmd}`;
    }
    // `window.__shardxMockFailWith = { cmd: "message" }`: the next call of cmd
    // fails with that exact text, so a test can see a known backend message
    // explained (audit Phase G3).
    const failWith = (window as { __shardxMockFailWith?: Record<string, string> }).__shardxMockFailWith;
    if (failWith && cmd in failWith) {
      const message = failWith[cmd];
      delete failWith[cmd];
      throw message;
    }
    // `window.__shardxMockGpuCapsHang = true`: the engine's GPU check never answers
    // (a VPS without a display). Not counted in flight: the UI must not wait on it.
    if ((cmd === "gpu_caps" || cmd === "gpu_caps_compat") && (window as { __shardxMockGpuCapsHang?: boolean }).__shardxMockGpuCapsHang) {
      return new Promise<never>(() => {});
    }
    // Slow (non-polling) calls in flight, so tests can wait for the UI to settle.
    const slow = !FAST.has(cmd);
    if (slow) pending++;
    // `window.__shardxMockSlow = { cmd: ms }` holds a command back longer, as
    // set when the call starts (a test can then make the next call fast).
    const extra = (window as { __shardxMockSlow?: Record<string, number> }).__shardxMockSlow?.[cmd];
    try {
      // `window.__shardxMockLatency = ms` replaces the 60 to 180 ms every
      // slow command waits (0: answer at once), for tests of fast loads.
      const latency = (window as { __shardxMockLatency?: number }).__shardxMockLatency;
      if (slow) await sleep(latency ?? 60 + Math.random() * 120);
      if (extra) await sleep(extra);
      // Across the real IPC both ways are JSON: the app never shares an object
      // with the backend's state, so neither may mutate the other's.
      const copy = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
      // The space in use's lists in place; a write the edition places is refused first (spaces.ts).
      settle(state, emit);
      const refused = refusal(state, cmd, args);
      if (refused) throw refused;
      // A team's door, by the rights its permission carries (teamRights.ts).
      const door = teamDoor(state, cmd, args);
      if (door) throw door;
      const out = copy(teamView(state, cmd, await fn(copy(args), ctx)));
      mirror(state);
      // `window.__shardxMockLate = { cmd: ms }`: the answer is read now and arrives ms later,
      // as a read of a space the launcher has left since.
      const late = (window as { __shardxMockLate?: Record<string, number> }).__shardxMockLate?.[cmd];
      if (late) await sleep(late);
      return out;
    } catch (e) {
      // Tauri rejects with the Err value itself; the app does String(e).
      throw typeof e === "string" ? e : (e as Error)?.message ?? String(e);
    } finally {
      if (slow) pending--;
    }
  };

  const internals = {
    invoke,
    transformCallback(cb: Callback, once = false): number {
      const id = nextCallbackId++;
      callbacks.set(id, { cb, once });
      (window as any)[`_${id}`] = (payload: unknown) => {
        const entry = callbacks.get(id);
        if (!entry) return;
        entry.cb(payload);
        if (once) callbacks.delete(id);
      };
      return id;
    },
    unregisterCallback(id: number): void {
      callbacks.delete(id);
      delete (window as any)[`_${id}`];
    },
    convertFileSrc: (path: string) => path,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
      windows: [{ label: "main" }],
      webviews: [{ windowLabel: "main", label: "main" }],
    },
    plugins: {},
  };

  (window as any).__TAURI_INTERNALS__ = internals;
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event: string, id: number) { listeners.get(event)?.delete(id); },
  };

  (window as any).__shardxMock = {
    get state() { return state; },
    /** Slow commands still in flight; 0 once the UI has what it asked for. */
    get pending() { return pending; },
    windowCalls,
    windowArgs,
    calls,
    log,
    emit,
    /** The space's edition now. */
    get epoch() { return spaceEpoch(); },
    /** As live.rs moves the launcher; `{ tell: false }`: the window has not heard yet. */
    moveSpace(space: NonNullable<typeof state.space>, opts?: { tell?: boolean }) { moveSpace(state, space, emit, opts?.tell ?? true); saveState(state); },
    /** The team in use's reach as its next read finds it, told with "team-status". */
    teamStatus(next: Partial<TeamStatus>) { setTeamStatus(state, next, emit); },
    /** The rules the member this launcher joined as holds now, told as a new permission is. */
    teamGrants(grants: Grant[]) { setMyGrants(state, grants, emit); saveState(state); },
    /** Another device opens a team profile (`null`: it closed it there). */
    teamOpenOn(id: string, on: { device_name: string; member_name: string } | null) { setLease(state, id, on, emit); saveState(state); },
    /** Another member saves a team project: its revision moves on, unannounced. */
    teamProjectSaved(id: string) { savedElsewhere(state, id); saveState(state); },
    /** A team profile's browser closes here and its session ends so (open.rs `tell`); `why` for not_saved. */
    teamSessionEnds(id: string, outcome: SessionOutcome, why?: string, unsent?: boolean) { delete state.running[id]; saveState(state); sessionEnded(state, id, outcome, emit, why, unsent); },
    /** Its browser closes and the server does not take its session: sent again until `teamSessionEnds`. */
    teamSessionResends(id: string, why?: string) { sessionResent(state, id, emit, why); saveState(state); },
    /** Another device deletes something in the team in use: a row in its trash. */
    teamTrashAdd(row: MockTrashRow) { addTeamTrash(state, row, emit); saveState(state); },
    /** As live.rs: the team in use withdraws this launcher ("revoked": its open profiles close
     *  unsaved) or replaces its invite ("replaced": they close, kept here); then the space moves. */
    teamWithdraw(kind: "revoked" | "replaced") { withdraw(state, kind, emit); saveState(state); },
    reset() { state = resetState(); location.reload(); },
    save: () => saveState(state),
  };

  // e2e tests raise toasts without a flow that makes one (e2e/toasts.spec.ts).
  (window as any).__shardxToast = toast;

  console.info("%c[mock] ShardBrowser Tauri IPC shim active. Reset: __shardxMock.reset() or ?mock=reset", "color:#535efd;font-weight:600");
}

install();

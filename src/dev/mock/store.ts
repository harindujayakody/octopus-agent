// State holder for the mock: one in-memory object, persisted to localStorage
// so edits made in the UI survive a reload. `?mock=reset` on the URL, or
// `__shardxMock.reset()` in the console, drops it back to the seed;
// `?mock=empty` drops it to an empty install.
import { seed, SEED_VERSION, type MockState } from "./fixtures";

const KEY = "shardx-mock-state";

export function loadState(): MockState {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mock");
  // `?mock=empty`: back to the seed, as a fresh install (no profiles,
  // proxies, trash, bookmarks or extensions).
  if (mode === "empty") (window as { __shardxMockEmpty?: boolean }).__shardxMockEmpty = true;
  if (mode === "reset" || mode === "empty") {
    try { localStorage.removeItem(KEY); } catch { /* private mode */ }
    params.delete("mock");
    const q = params.toString();
    history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`);
    return seed();
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MockState;
      if (parsed.version === SEED_VERSION) return parsed;
    }
  } catch { /* corrupt or unavailable: fall through to the seed */ }
  return seed();
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: MockState | undefined;

/** Debounced write; the polling commands would otherwise serialise every 20ms. */
export function saveState(state: MockState): void {
  pending = state;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 200);
}

/** Writes the debounced state now. Runs on pagehide, so a reload never
 *  drops the last edit. */
function flush(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!pending) return;
  try { localStorage.setItem(KEY, JSON.stringify(pending)); } catch { /* quota or private mode */ }
  pending = undefined;
}

window.addEventListener("pagehide", flush);

export function resetState(): MockState {
  if (timer) clearTimeout(timer);
  timer = undefined;
  pending = undefined;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return seed();
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function newId(): string {
  return Math.random().toString(16).slice(2, 10);
}

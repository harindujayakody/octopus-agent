/** One recorded step. `kind` and `params` stay open so the palette can grow
 *  without a storage migration. */
/** Where the run goes after a step. A flat list cannot express "and if this is
 *  not there, do that instead", which is half of any real script. */
export type Branch =
  | "next"
  | "stop"
  | "endpass"
  | { goto: string }
  | { retry: number };

export type Block = {
  id: string;
  kind: string;
  label: string;
  params: Record<string, unknown>;
  enabled: boolean;
  /** Parameter names never written into an export. */
  secrets: string[];
  /** Where the block sits on the canvas. Layout only — the run follows the
   *  connections, never the coordinates. */
  x: number;
  y: number;
  on_done: Branch;
  /** Defaults to "stop": carrying on after a click that found nothing is how a
   *  run ends up typing into the wrong page. */
  on_fail: Branch;
};

export function branchKind(b: Branch): "next" | "stop" | "endpass" | "goto" | "retry" {
  if (typeof b === "string") return b;
  return "goto" in b ? "goto" : "retry";
}

export function branchLabel(b: Branch, steps: Block[]): string {
  const k = branchKind(b);
  if (k === "next") return "next step";
  if (k === "stop") return "stop this profile";
  if (k === "endpass") return "end the pass";
  if (k === "retry") return `retry ${(b as { retry: number }).retry}×`;
  const id = (b as { goto: string }).goto;
  const i = steps.findIndex((x) => x.id === id);
  return i >= 0 ? `go to step ${i + 1}` : "go to (missing step)";
}

export type RunSettings = {
  threads: number;
  /** Passes over the graph; 0 means run until `hours` is up. */
  loops: number;
  hours: number;
  /** Kept for projects saved before profiles became blocks. */
  profiles: string[];
  /** Which block the run starts at; empty means the first. */
  start: string;
};

export type Project = {
  id: string;
  name: string;
  notes: string;
  blocks: Block[];
  run: RunSettings;
  /** Request-interception rules mounted before the first navigation of every
   *  profile this project drives. */
  rules?: TrafficRule[];
  created_at: number;
  updated_at: number;
  /** A team's revision of it, as read; a save from an older one is refused as stale. None in the personal space. */
  revision?: number;
};

// ---- Request interception (Traffic domain) ----

export type TrafficHeaderOp = { name: string; value: string };

export type TrafficMatch = {
  url?: string;
  host?: string;
  method?: string;
  resource?: string;
  urlRegex?: string;
  hostRegex?: string;
};

export type TrafficActionType =
  | "continue"
  | "modify"
  | "block"
  | "redirect"
  | "fulfill";

export type TrafficAction = {
  type: TrafficActionType;
  // request stage
  setHeaders?: TrafficHeaderOp[];
  removeHeaders?: string[];
  setMethod?: string;
  setUrl?: string;
  setBody?: string;
  delayMs?: number;
  blockReason?: string;
  // fulfill (synthetic response)
  status?: number;
  responseHeaders?: TrafficHeaderOp[];
  responseBody?: string;
  // response stage (edit the real response)
  setResponseHeaders?: TrafficHeaderOp[];
  removeResponseHeaders?: string[];
  setStatus?: number;
  setResponseBody?: string;
};

export type TrafficRule = {
  match: TrafficMatch;
  action: TrafficAction;
  await?: boolean;
};

/** A request the core paused because it matched an await rule. */
export type TrafficPaused = {
  requestId: string;
  request: {
    url: string;
    method: string;
    resource: string;
    headers: Record<string, string>;
  };
};

/** One screencast frame, as the backend forwards it. */
export type Frame = {
  profile_id: string;
  /** base64 JPEG. */
  data: string;
  width: number;
  height: number;
  offset_top: number;
  page_scale: number;
  scroll_x: number;
  scroll_y: number;
};

/** What a recorded right-click resolved to, resolved natively in the browser. */
export type Picked = {
  /** Empty when nothing unique was found; the step falls back to the point. */
  selector: string;
  tag: string;
  label: string;
  x: number;
  y: number;
  /** Candidates that were tried, and why each was turned down. */
  tried: string[];
};

export type WorkerState = {
  profile_id: string;
  profile_name: string;
  pass: number;
  step: number;
  steps_total: number;
  status: "queued" | "starting" | "running" | "done" | "failed" | "stopped";
  note: string;
};

export type RunState = {
  project_id: string;
  project_name: string;
  started_at: number;
  running: boolean;
  workers: WorkerState[];
  log: string[];
};

export type NeedsSecret = { block_id: string; label: string; params: string[] };

export type Bundle = {
  format: number;
  exported_at: number;
  project: Project;
  /** Module ids the project's steps call. */
  modules: string[];
  /** Those modules' files, travelling inside the bundle. */
  module_files?: { id: string; wasm: string }[];
  needs: NeedsSecret[];
};

export type ModuleInfo = {
  id: string;
  name: string;
  path: string;
  blocks: BlockSpecJson[];
  /** Empty when the module loaded. */
  error: string;
};

/** A module's block descriptor: the same shape as the built-in palette. */
export type BlockSpecJson = {
  kind: string;
  label: string;
  about?: string;
  /** Which picker group this action joins. A built-in group's name or id
   *  ("Navigation", "data", "Flow"…) drops it in there; any other name makes a
   *  new group with that title; omitted, it lands in the module's own group. */
  group?: string;
  params?: {
    name: string;
    label: string;
    kind?: string;
    hint?: string;
    default?: unknown;
    /** Offers the "secret" toggle — a password or a token, not a selector. */
    secret?: boolean;
  }[];
};

export type DisplayInfo = {
  server: string;
  limited: boolean;
  note: string;
  /** Browsers can be placed, so arranging them works (X11, or XWayland). */
  browser_placement: boolean;
  /** The launcher's own panels can sit on top and be positioned. */
  panels: boolean;
};

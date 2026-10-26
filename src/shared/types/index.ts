export const SECTIONS = [
  "profiles",
  "proxies",
  "fingerprints",
  "extensions",
  "bookmarks",
  "automation",
  "trash",
  "settings",
  "team",
] as const;
export type Section = (typeof SECTIONS)[number];

export type ToastKind = "ok" | "err" | "info" | "warn" | "progress";
/** A button on a toast that does the obvious next thing ("Assign a proxy"). */
/** `run` may return false to say it did nothing: the toast then stays (SH4). */
export type ToastAction = { label: string; run: () => void | boolean };
export type ToastItem = {
  id: number;
  kind: ToastKind;
  /** What happened, naming its subject: "Couldn't start “Sandbox”". */
  title: string;
  /** Why: the backend's words, second line, muted. */
  detail?: string;
  /** The object the toast is about (a profile name). */
  subject?: string;
  /** A next step; with `onUndo` it shows beside Undo ("Assign replacements…"). */
  action?: ToastAction;
  /** Puts back what the toast reports; shown as an Undo button (and Cmd/Ctrl+Z). */
  onUndo?: () => void;
  /** How many times this toast was raised. Never drawn: the announcer says a repeat again. */
  raised: number;
  progress?: { done: number; total: number };
  /** Dismissed: kept for its exit, then removed by the host. */
  leaving?: boolean;
};

export type ConfirmButton = { label: string; value: any; danger?: boolean; primary?: boolean };
/** One line of a list under the question: what it names, and what becomes of it. */
export type ConfirmItem = { label: string; note?: string };
export type ConfirmReq = {
  title: string;
  message: string;
  /** Named under the message (the profiles a Quit closes). */
  items?: ConfirmItem[];
  buttons: ConfirmButton[];
  /** Read as an alert with its consequence on open, though nothing is destroyed (a purchase). */
  alert?: boolean;
  resolve: (v: any) => void;
};


export type OsPlatform = "macOS" | "Windows" | "Linux";

export type IconProps = { size?: number; className?: string };

export type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
  /** A password or key: see the kit Input's `secret`. */
  secret?: boolean;
  /** What is wrong with the value, under the field. */
  error?: string;
};


/** runtime.rs PlatformSpec. */
export type RtSpec = {
  browser: { key: string; label: string };
};
export type RtStatus = {
  installed: boolean;
  binary_path: string | null;
  installed_browser_etag: string | null;
  remote_browser_etag: string | null;
  update_available: boolean;
  spec: RtSpec | null;
  fingerprints_installed: boolean;
  /** The published engine wants a newer launcher; no engine update is offered. */
  needs_newer_launcher: boolean;
  min_launcher_version: string | null;
  launcher_version: string;
  /** Why the last install stopped, while its update is still due or nothing is installed. */
  install_error: RtInstallError | null;
  /** The update is downloaded and checked; only the swap is left. */
  update_staged: boolean;
};
/** runtime.rs InstallError, also the `runtime:failed` payload (#122). */
export type RtInstallError = {
  stage: "download" | "space" | "extract" | "verify" | "busy" | "swap";
  message: string;
  /** Profiles running on the engine (stage busy), else 0. */
  running_browsers: number;
  /** Profile starts under way (stage busy), else 0. */
  starting: number;
  /** The previous engine is installed and works. */
  engine_kept: boolean;
  /** The archive etag (else the version) the attempt was for. */
  target: string | null;
  at_ms: number;
};
/** The `runtime:failed` payload: the stop, and whether its update is unpacked here already. */
export type RtFailed = RtInstallError & { update_staged: boolean };
export type RtProgress = {
  label: string;
  phase: "download" | "extract";
  received: number;
  total: number;
  percent: number;
};
export type RtUpdate = {
  current: string;
  latest: string | null;
  update_available: boolean;
  release_url: string | null;
};

/** Where an extension came from: only a Web Store item in v1 (source.rs SourceRef). */
export type ExtensionSource = { kind: "webstore"; id: string } | { kind: "url"; url: string };

export type ExtensionEntry = {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Largest icon the manifest declares, as a data: URL. Empty when it has none. */
  icon: string;
  path: string;
  size_bytes: number;
  /** "@<unix_secs>". */
  added_at: string;
  /** Absent: not linked to the Web Store yet. */
  source?: ExtensionSource;
};

/** What `extension_import` came to: each file refused, with why (extensions.rs `Imported`). */
export type ExtensionImport = { added: ExtensionEntry[]; refused: { path: string; error: string }[] };

// ---- Updates from the Web Store (updates.rs) ----

export type ExtensionFlag = "malware" | "policy_violation" | "potentially_uws";

export type ExtensionUpdateState =
  | "unlinked" | "unchecked" | "current" | "available" | "downloading" | "ready"
  | "waiting" | "applying" | "confirm" | "failed" | "needs_engine" | "id_conflict";

/** One kind of access a new version gains (manifest_edit.rs Grant). */
export type GrantKind =
  | "permission" | "host" | "script_host" | "main_world" | "connectable" | "web_resource" | "manifest_version" | "override";
export type Grant = { kind: GrantKind; value: string };

/** A profile an update waits for. */
export type ExtensionHolder = { id: string; name: string };

export type UpdatePhase = "download" | "verify" | "unpack" | "apply";
export type UpdateProgress = { phase: UpdatePhase; received: number; total: number };

export type ExtensionUpdate = {
  /** The library entry's id. */
  id: string;
  state: ExtensionUpdateState;
  installed: string;
  latest: string | null;
  size: number | null;
  /** Unix seconds. */
  first_seen: number | null;
  ready_since: number | null;
  /** Empty while waiting: the launcher itself is busy. */
  waiting_on: ExtensionHolder[];
  progress: UpdateProgress | null;
  error: string | null;
  checked_at: number | null;
  flags: ExtensionFlag[];
  allowlisted: boolean | null;
  skipped: string | null;
  needs_engine: string | null;
  confirm?: {
    reason: "permissions" | "identity";
    grown: Grant[];
    names?: { old: string; new: string };
    /** 0..1 */
    overlap?: number;
  };
};

export type UpdateResult =
  | { result: "applied"; from: string; to: string }
  | { result: "waiting"; waiting_on: ExtensionHolder[] }
  | { result: "confirm"; update: ExtensionUpdate }
  | { result: "needs_engine"; version: string }
  | { result: "not_served" }
  | { result: "current" };

export type LinkResult =
  | { result: "linked"; source: ExtensionSource; allowlisted: boolean | null; update: ExtensionUpdate | null }
  | {
    result: "confirm";
    names: { old: string; new: string };
    installed: string;
    store: string;
    overlap: number;
    kin: "same" | "unsure";
    allowlisted: boolean | null;
    flags: ExtensionFlag[];
  };

/** `extension-update:progress`. */
export type UpdateProgressEvent = UpdateProgress & { id: string };

/** `extension-updates:news`: what a background check found that no toast told yet. */
export type UpdateNews = {
  fresh: { id: string; name: string; version: string }[];
  flagged: { id: string; name: string; flags: ExtensionFlag[] }[];
};

/** The refusal to add what the library holds already (extensions.rs already_in_library). */
export type AlreadyInLibrary = { entry_id: string; installed: string; separate: boolean };

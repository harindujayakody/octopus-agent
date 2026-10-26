// Personal sync as the backend answers it: these names, arguments, results
// and the event are the contract the Rust side implements.
import type { ProfileMeta } from "../../profile/model/types";

/** "selected": the profiles the person picked; "all": every profile. */
export type SyncProfiles = "selected" | "all";
/** "bound": the proxies of synced profiles; "all": every proxy. */
export type SyncProxies = "bound" | "all";

/** What syncs, the same on all the person's computers. App settings and the fingerprint library never do. */
export type SyncKinds = {
  profiles: SyncProfiles;
  proxies: SyncProxies;
  folders_tags: boolean;
  bookmarks: boolean;
  /** With their files. */
  extensions: boolean;
  /** Secret step params never leave this computer. */
  automation: boolean;
};

/** The team server that holds the person's own space; `own`: they are its admin. */
export type SyncConnection = { server: string; teamId: string; own: boolean; device_name: string };

export type SyncStatus = {
  state: "idle" | "syncing" | "offline" | "error";
  /** Unix seconds of the last finished sync. */
  last_sync_at?: number;
  /** Changes made here that the server has not taken yet. */
  pending: number;
  /** The backend's own words, with state "error". */
  error?: string;
};

export type SyncState = {
  /** Up by one on every change: the app drops a reply or event older than what it holds (Tauri keeps no order). */
  rev: number;
  connection: SyncConnection | null;
  kinds: SyncKinds;
  status: SyncStatus;
};

/** On ProfileMeta only for personal-space rows while connected; never on a team space's rows. */
export type ProfileSync = {
  /** Effective: true for every profile while kinds.profiles is "all" (each keeps its own pick for "selected"). */
  on: boolean;
  /** The other device holding its lease: Start is refused here. */
  open_on?: string;
  /** Unix seconds that device last checked in. */
  seen_at?: number;
  conflict?: boolean;
};

/** An invite's server and token, or a joined team's server. */
export type SyncConnectArgs = { server: string; token: string } | { teamId: string };

/** Every sync command: name, arguments, answer. A refusal rejects with the backend's words (SYNC_REFUSALS). */
export type SyncCommands = {
  sync_state: { args: Record<string, never>; result: SyncState };
  sync_connect: { args: SyncConnectArgs; result: SyncState };
  /** Local copies always stay. Changes still waiting are dropped; the app says so first. */
  sync_disconnect: { args: { removeFromServer: boolean }; result: SyncState };
  /** The app sends one at a time, the whole set each time. */
  sync_set_kinds: { args: { kinds: SyncKinds }; result: SyncState };
  /** Answers at once with status "syncing"; the end comes as SYNC_CHANGED. */
  sync_now: { args: Record<string, never>; result: SyncState };
  /** What another of the person's computers pastes: "<server>#<token>" for this person's space. */
  sync_invite: { args: Record<string, never>; result: { invite: string } };
  /** The name the person's other computers see ("Open on …"); 1 to 64 characters. */
  sync_set_device_name: { args: { name: string }; result: SyncState };
  /** Refuses to turn off a profile another device holds (SYNC_REFUSALS.leasedStop). */
  profile_sync_set: { args: { ids: string[]; on: boolean }; result: ProfileMeta[] };
  /** Takes the lease from the device holding it, which closes it at its next sync;
   *  what that device had not synced comes back as a "(conflict copy)". */
  profile_sync_take: { args: { id: string }; result: ProfileMeta };
};

export type SyncCommand = keyof SyncCommands;

/** Emitted with the new SyncState on every change; "store-changed" ("profiles") follows when rows changed. */
export const SYNC_CHANGED = "sync-changed";

/// The backend's exact refusals, which the app translates (lib/errors.ts). Every launch
/// path (launch, sync_launch, automation_launch, the Local API) refuses with `leased`.
export const SYNC_REFUSALS = {
  leased: (device: string) => `this profile is open on ${device}: close it there first`,
  leasedStop: (device: string) => `this profile is open on ${device}: stop syncing it there`,
  alreadyConnected: "sync is already connected: disconnect first",
  notConnected: "sync is not connected",
  notMember: "not a member of that team",
  noAnswer: (host: string) => `the sync server at ${host} did not answer`,
  /** To another device, after one of them removed the person's data from the server. */
  removed: "your synced data was removed from this server",
  deviceName: "a device name is 1 to 64 characters",
} as const;

/// Why a sync stopped short, as `status.error` says it (space/sync/cycle.rs); the app translates them.
export const SYNC_STOPS = {
  /** Every synced profile gone from here at once, none through the Trash (VANISHED). */
  vanished: "none of the synced profiles is on this computer any more, so nothing was deleted from the server: is the data folder where it was?",
  /** What is here could not be read, so none of it is taken for deleted (`unread`). */
  unread: (what: string, why: string) => `${what} on this computer could not be read: ${why}`,
} as const;

/** What syncs right after connecting. */
export const DEFAULT_KINDS: SyncKinds = {
  profiles: "selected", proxies: "bound", folders_tags: true, bookmarks: true, extensions: true, automation: true,
};

import { create } from "zustand";
import { LANG_OPTIONS, translate } from "../../../shared/i18n";
import { randomId } from "../../../shared/lib/utils";
import { emptyFilters, isProxyFilter, proxyIdOf, type ProfileFilters, type ProfileSort } from "./listing";
import { PROFILE_COLUMNS, readProfileColumns, type ProfileColumns } from "./columns";
import { defaultSet, sameSet } from "../../../shared/lib/tableColumns";
import { onSpaceChange, spaceKey } from "../../space";

/// Views: named copies of the Profiles list's query. Kept by the app on this
/// computer (owner decision, Phase 4: frontend only), in the shape the backend
/// should store later; each space has its own (`spaceKey`).
const KEY = "shardx.views";
const VERSION = 1;
/** Longest View name; it has to fit the sidebar. */
export const VIEW_NAME_MAX = 40;

/** What a View holds: the list's Folder, filters, order and columns. */
export type ViewQuery = { folder: string; filters: ProfileFilters; sort: ProfileSort; columns: ProfileColumns };

export type ProfileView = {
  id: string;
  /** A built-in's name is an i18n key: read it with `viewName`. */
  name: string;
  /** Shown in the sidebar. Built-ins always are. */
  pinned: boolean;
  builtin: boolean;
  /** A built-in's sidebar icon; custom Views share one. */
  icon?: "running" | "direct" | "recent";
  query: ViewQuery;
};

const query = (over: { filters?: Partial<ProfileFilters>; sort?: ProfileSort }): ViewQuery => ({
  folder: "all",
  filters: { ...emptyFilters(), ...over.filters },
  sort: over.sort ?? "added",
  columns: defaultSet(PROFILE_COLUMNS),
});

/** What All shows: every Folder, no filter, the first order, the default
 *  columns. A list that differs from it can be saved as a View. */
export const allQuery = (): ViewQuery => query({});

/// Built-ins filter and order; they keep the columns the list has (see
/// `viewQuery`), and cannot be changed or deleted.
export const BUILTIN_VIEWS: ProfileView[] = [
  {
    id: "builtin:running", name: "views.running", pinned: true, builtin: true, icon: "running",
    query: query({ filters: { status: "running" } }),
  },
  {
    id: "builtin:no-proxy", name: "views.noProxy", pinned: true, builtin: true, icon: "direct",
    query: query({ filters: { proxy: "direct" } }),
  },
  {
    id: "builtin:recent", name: "views.recent", pinned: true, builtin: true, icon: "recent",
    query: query({ filters: { lastRun: "week" }, sort: "launched-desc" }),
  },
];

/** What exists now, for `viewQuery`: Folders, tag ids and proxy ids. */
export type ViewContext = { folders: string[]; tagIds: string[]; proxyIds: string[] };

/** The query a View puts on the list: a built-in keeps the list's own
 *  columns, a Folder that no longer exists shows every Folder, and a deleted
 *  tag or proxy stops filtering. */
export function viewQuery(view: ProfileView, listColumns: ProfileColumns, known: ViewContext): ViewQuery {
  let q = view.builtin ? { ...view.query, columns: listColumns } : view.query;
  if (q.folder !== "all" && !known.folders.includes(q.folder)) q = { ...q, folder: "all" };
  if (q.filters.tag && !known.tagIds.includes(q.filters.tag)) q = { ...q, filters: { ...q.filters, tag: "" } };
  const onId = proxyIdOf(q.filters.proxy);
  if (onId !== null && !known.proxyIds.includes(onId)) q = { ...q, filters: { ...q.filters, proxy: "all" } };
  return q;
}

/** The filters a View sets itself (a deleted tag or proxy no longer filters). */
export const viewOwnFilters = (view: ProfileView, listColumns: ProfileColumns, known: ViewContext): ProfileFilters =>
  viewQuery(view, listColumns, known).filters;

/** Whether two queries show the same list. */
export function sameQuery(a: ViewQuery, b: ViewQuery): boolean {
  const keys = <T extends object>(o: T) => Object.keys(o) as (keyof T)[];
  return a.folder === b.folder && a.sort === b.sort
    && keys(a.filters).every((k) => a.filters[k] === b.filters[k])
    && sameSet(a.columns, b.columns);
}

// ---- Reading a saved value ---------------------------------------------------

const SORTS: readonly ProfileSort[] = ["added", "name-asc", "name-desc", "created-desc", "created-asc", "launched-desc", "runtime-desc", "status"];
const FILTER_VALUES: { [K in keyof ProfileFilters]: (v: unknown) => boolean } = {
  status: (v) => v === "all" || v === "running" || v === "idle",
  country: (v) => typeof v === "string",
  proxy: isProxyFilter,
  tag: (v) => typeof v === "string",
  lastRun: (v) => typeof v === "string" && ["any", "day", "week", "month", "stale", "unused", "never"].includes(v),
};

/// A saved query over the defaults: a filter or column saved before it existed
/// (or with a value this version doesn't know) gets its "any" value.
function readQuery(raw: unknown): ViewQuery {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = query({});
  if (typeof r.folder === "string" && r.folder) out.folder = r.folder;
  if (SORTS.includes(r.sort as ProfileSort)) out.sort = r.sort as ProfileSort;
  const f = (r.filters && typeof r.filters === "object" ? r.filters : {}) as Record<string, unknown>;
  for (const k of Object.keys(FILTER_VALUES) as (keyof ProfileFilters)[]) {
    if (FILTER_VALUES[k](f[k])) (out.filters as Record<string, unknown>)[k] = f[k];
  }
  // Either shape: { order, hidden } (made whole: unknown ids drop, new
  // columns join hidden) or the booleans Views saved before it.
  out.columns = readProfileColumns(r.columns);
  return out;
}

/** The saved custom Views; a missing, broken or other-version value means none. */
function load(): ProfileView[] {
  try {
    const raw = JSON.parse(localStorage.getItem(spaceKey(KEY)) ?? "null") as { version?: unknown; views?: unknown } | null;
    if (!raw || raw.version !== VERSION || !Array.isArray(raw.views)) return [];
    const out: ProfileView[] = [];
    for (const v of raw.views as Record<string, unknown>[]) {
      if (!v || typeof v.id !== "string" || typeof v.name !== "string" || !v.name.trim()) continue;
      if (out.some((x) => x.id === v.id)) continue;
      out.push({ id: v.id, name: v.name, pinned: v.pinned !== false, builtin: false, query: readQuery(v.query) });
    }
    return out;
  } catch {
    return [];
  }
}

function save(views: ProfileView[]) {
  const saved = views.map(({ id, name, pinned, query: q }) => ({ id, name, pinned, query: q }));
  try { localStorage.setItem(spaceKey(KEY), JSON.stringify({ version: VERSION, views: saved })); } catch { /* private mode */ }
}

// ---- The store -----------------------------------------------------------------

export type ViewStore = {
  /** Custom Views only, in the order they were made. */
  views: ProfileView[];
  /** A new View, or null when the name is empty or taken. */
  save: (name: string, query: ViewQuery, pinned: boolean) => ProfileView | null;
  update: (id: string, query: ViewQuery) => void;
  /** False when the name is empty or taken. */
  rename: (id: string, name: string) => boolean;
  setPinned: (id: string, pinned: boolean) => void;
  remove: (id: string) => void;
  /** Puts a removed View back where it was (Undo). */
  restore: (view: ProfileView, index: number) => void;
  /** Every View that names Folder `from` names `to` instead. */
  renameFolder: (from: string, to: string) => void;
};

const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, VIEW_NAME_MAX);

/** The built-ins' names in every language: a custom View can't take one. */
export const builtinNames = () => BUILTIN_VIEWS.flatMap((v) => LANG_OPTIONS.map((o) => translate(o.value, v.name)));

/// Custom names are unique without regard to case, among custom Views and the
/// built-ins' shown names.
export function viewNameTaken(name: string, views: ProfileView[], builtinNames: string[], exceptId?: string): boolean {
  const n = cleanName(name).toLocaleLowerCase();
  return builtinNames.some((b) => b.toLocaleLowerCase() === n)
    || views.some((v) => v.id !== exceptId && v.name.toLocaleLowerCase() === n);
}

const newId = () => `v-${randomId()}`;

export const useViews = create<ViewStore>((set, get) => {
  const commit = (views: ProfileView[]) => { save(views); set({ views }); };
  const taken = (name: string, exceptId?: string) =>
    viewNameTaken(name, get().views, builtinNames(), exceptId);
  return {
    views: load(),
    save: (name, q, pinned) => {
      const n = cleanName(name);
      if (!n || taken(n)) return null;
      const view: ProfileView = { id: newId(), name: n, pinned, builtin: false, query: q };
      commit([...get().views, view]);
      return view;
    },
    update: (id, q) => commit(get().views.map((v) => (v.id === id ? { ...v, query: q } : v))),
    rename: (id, name) => {
      const n = cleanName(name);
      if (!n || taken(n, id)) return false;
      commit(get().views.map((v) => (v.id === id ? { ...v, name: n } : v)));
      return true;
    },
    setPinned: (id, pinned) => commit(get().views.map((v) => (v.id === id ? { ...v, pinned } : v))),
    remove: (id) => commit(get().views.filter((v) => v.id !== id)),
    restore: (view, index) => {
      if (get().views.some((v) => v.id === view.id)) return;
      const next = [...get().views];
      next.splice(Math.min(index, next.length), 0, view);
      commit(next);
    },
    renameFolder: (from, to) => {
      if (!get().views.some((v) => v.query.folder === from)) return;
      commit(get().views.map((v) => (v.query.folder === from ? { ...v, query: { ...v.query, folder: to } } : v)));
    },
  };
});

// Another space shows its own Views.
onSpaceChange(() => useViews.setState({ views: load() }));

/** Built-ins, then custom Views. */
export function allViews(custom: ProfileView[] = useViews.getState().views): ProfileView[] {
  return [...BUILTIN_VIEWS, ...custom];
}

export function findView(id: string | null): ProfileView | null {
  return id ? allViews().find((v) => v.id === id) ?? null : null;
}

/** The name to show: a built-in's in the app's language. */
export function viewName(view: ProfileView, t: (key: string) => string): string {
  return view.builtin ? t(view.name) : view.name;
}

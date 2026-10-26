import { create } from 'zustand'
import { ProxyEntry, ProxyTestSnapshot } from '../model/types'
import { proxyFullTest, proxyLastTest, proxyList, proxyDelete, proxySave, proxyBulkImport } from '../model/api';
import { onProxy, teamRefusal } from '../../space';
import { toast } from '../../../shared/model/toast';
import { clip, copySecret } from '../../../shared/lib/clipboard';
import { deferDelete } from '../../../shared/lib/deferDelete';
import { clipboardTooBig } from '../../../shared/lib/pickFile';
import { storeBus } from '../../../shared/lib/storeBus';
import { onSpaceMoved } from '../../../shared/api/invoke';
import { markArrived } from '../../../shared/lib/arrival';
import { eachReporting } from '../../../shared/lib/eachReporting';
import { t } from '../../../shared/i18n';
import { ProfileMeta } from '../../profile/model/types';
import { proxyStatus } from './status';

// The delete toast's "Assign replacements…" opens Assign proxies for the
// profiles that used the deleted proxies. That dialog belongs to the
// Profiles side, which imports this store, so it registers here.
let onAssignReplacements: ((profileIds: string[]) => void) | null = null;
export function setOnAssignReplacements(fn: ((profileIds: string[]) => void) | null) { onAssignReplacements = fn; }

/** Proxies deleted behind an Undo toast that has not gone yet: every list of
 *  proxies (this store's and the Profiles store's) leaves them out, so the
 *  profiles on one read "Proxy missing" meanwhile. */
export const pendingProxyIds = new Set<string>();
/** Proxies coming back from a delete (Undone, or the commit failed): the next
 *  read has them and `had` lacks them, but they are not new, so no arrival flash. */
const comingBack = new Set<string>();

/// Hides proxies at once and deletes them when their Undo toast goes
/// (ruling 18). Profiles that used them read "Proxy missing" meanwhile; the
/// toast says how many, and "Assign replacements…" deletes now and opens
/// Assign for those profiles (plan ruling 9), only the ones whose proxy
/// really went (A Task 14). A failure names what failed and puts it back.
/// The deleted rows leave the selection, and Undo puts them back in it, as
/// a failed delete does (owner rule; LQ-02).
function deleteProxies(get: () => ProxyStore, set: (p: Partial<ProxyStore>) => void, asked: ProxyEntry[]) {
    // A team's rules first: one it may not delete never leaves the list, so it never comes back either.
    const refused = asked.filter((p) => teamRefusal('delete', onProxy(p.id)));
    if (refused.length > 0) {
        const name = refused[0].name || `${refused[0].host}:${refused[0].port}`;
        toast.fail({
            title: refused.length === 1 ? t("useProxy.deleteFailedOne", { name }) : t("useProxy.deleteFailedMany", { n: refused.length }),
            detail: teamRefusal('delete', onProxy(refused[0].id)),
        });
    }
    const targets = asked.filter((p) => !refused.includes(p));
    if (targets.length === 0) return;
    const ids = new Set(targets.map((p) => p.id));
    const users = get().profiles.filter((p) => p.proxy_id !== null && ids.has(p.proxy_id)).map((p) => p.id);
    const nameOf = (p: ProxyEntry) => p.name || `${p.host}:${p.port}`;
    const one = targets.length === 1;
    const key = `proxies:${[...ids].sort().join(",")}`;
    let wasSelected: string[] = [];
    let failed: ProxyEntry[] = [];
    let lost: string[] = [];
    deferDelete({
        key,
        title: one ? t("useProxy.deletedOne", { name: nameOf(targets[0]) }) : t("useProxy.deletedMany", { n: targets.length }),
        detail: users.length === 0 ? undefined : users.length === 1 ? t("useProxy.losesOne") : t("useProxy.losesMany", { n: users.length }),
        failTitle: () => failed.length === 1
            ? t("useProxy.deleteFailedOne", { name: nameOf(failed[0]) })
            : t("useProxy.deleteFailedMany", { n: failed.length }),
        hide: () => {
            for (const id of ids) pendingProxyIds.add(id);
            wasSelected = [...ids].filter((id) => get().proxySel.has(id));
            set({ proxies: get().proxies.filter((p) => !ids.has(p.id)), proxySel: new Set([...get().proxySel].filter((id) => !ids.has(id))) });
            // The Profiles store reads its proxies again, without these.
            storeBus.emit('proxies', 'proxies');
        },
        restore: () => {
            for (const id of ids) { pendingProxyIds.delete(id); comingBack.add(id); }
            // A reload drops the ones that are really gone.
            if (wasSelected.length > 0) set({ proxySel: new Set([...get().proxySel, ...wasSelected]) });
            void get().reload().finally(() => { for (const id of ids) comingBack.delete(id); });
            storeBus.emit('proxies', 'proxies');
        },
        commit: async () => {
            // Who loses a proxy, read before the Profiles store learns it is gone.
            const before = new Map(get().profiles.map((p) => [p.id, p.proxy_id]));
            const result = await eachReporting(targets.map((p) => p.id), (id) => proxyDelete(id));
            const done = new Set(result.done);
            lost = users.filter((pid) => { const px = before.get(pid); return px != null && done.has(px); });
            failed = targets.filter((p) => !done.has(p.id));
            for (const id of ids) pendingProxyIds.delete(id);
            for (const p of failed) comingBack.add(p.id);
            try { await get().reload(); } finally { for (const p of failed) comingBack.delete(p.id); }
            // The profiles on them keep their ids: both lists change.
            storeBus.emit('proxies', 'proxies');
            storeBus.emit('profiles', 'proxies');
            if (failed.length > 0) throw new Error(result.firstError);
        },
        action: users.length > 0
            ? { label: t("useProxy.assignReplacements"), run: () => { if (lost.length > 0) onAssignReplacements?.(lost); } }
            : undefined,
    });
}

/** The Proxies Filters menu's choices (O8, IFACE-13). */
export type ProxyFilters = {
    /** What the last test says. */
    status: 'any' | 'working' | 'failed' | 'untested';
    /** Whether a profile uses it. */
    used: 'any' | 'used' | 'unused';
    kind: '' | 'socks5' | 'http' | 'https';
    /** An upper-case country code. */
    country: string;
};
export const emptyProxyFilters = (): ProxyFilters => ({ status: 'any', used: 'any', kind: '', country: '' });
export const countActiveProxyFilters = (f: ProxyFilters) =>
    (f.status !== 'any' ? 1 : 0) + (f.used !== 'any' ? 1 : 0) + (f.kind ? 1 : 0) + (f.country ? 1 : 0);

/** Display's order. `added` is the stored order. */
export type ProxySort = 'added' | 'name' | 'latency' | 'tested' | 'profiles';
const SORTS: readonly ProxySort[] = ['added', 'name', 'latency', 'tested', 'profiles'];
/** Saved, so the order comes back after a restart (owner, 2026-09-30). */
const SORT_KEY = 'shardx.proxies.sort';
const loadSort = (): ProxySort => {
    try { const v = localStorage.getItem(SORT_KEY); return SORTS.find((s) => s === v) ?? 'added'; }
    catch { return 'added'; }
};

/** What a proxy's last test says, in the Status filter's words. */
const testStateOf = (snap: ProxyTestSnapshot | undefined): 'working' | 'failed' | 'untested' => {
    const s = proxyStatus(snap);
    return s === 'ok' ? 'working' : s;
};
const stamp = (s: string | undefined) => (s ? Number(s.replace(/^@/, '')) || Date.parse(s) || 0 : 0);

/// Shared by the table and by shift-click, so a range covers what is visible.
export function filterProxies(
    proxies: ProxyEntry[],
    snapshots: Record<string, ProxyTestSnapshot>,
    search: string,
    filters: ProxyFilters = emptyProxyFilters(),
    /** Proxy id to how many profiles use it. */
    used: Record<string, number> = {},
): ProxyEntry[] {
    const q = search.trim().toLowerCase();
    if (!q && countActiveProxyFilters(filters) === 0) return proxies;
    return proxies.filter((p) => {
        const snap = snapshots[p.id];
        if (filters.status !== 'any' && testStateOf(snap) !== filters.status) return false;
        if (filters.used === 'used' && !(used[p.id] > 0)) return false;
        if (filters.used === 'unused' && used[p.id] > 0) return false;
        if (filters.kind && p.kind !== filters.kind) return false;
        if (filters.country && (snap?.country_code || p.country).toUpperCase() !== filters.country) return false;
        if (!q) return true;
        return (
            p.name.toLowerCase().includes(q) ||
            p.host.toLowerCase().includes(q) ||
            String(p.port).includes(q) ||
            p.country.toLowerCase().includes(q) ||
            p.notes.toLowerCase().includes(q) ||
            p.username.toLowerCase().includes(q) ||
            (snap?.ip ?? '').toLowerCase().includes(q) ||
            (snap?.city ?? '').toLowerCase().includes(q) ||
            (snap?.isp ?? '').toLowerCase().includes(q)
        );
    });
}

/** Display's order over the filtered list; `added` keeps the stored one. */
export function sortProxies(
    list: ProxyEntry[],
    sort: ProxySort,
    snapshots: Record<string, ProxyTestSnapshot>,
    used: Record<string, number>,
): ProxyEntry[] {
    if (sort === 'added') return list;
    const out = [...list];
    const latency = (p: ProxyEntry) => snapshots[p.id]?.tcp_ms ?? Number.POSITIVE_INFINITY;
    if (sort === 'name') out.sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host, undefined, { numeric: true }));
    if (sort === 'latency') out.sort((a, b) => latency(a) - latency(b));
    if (sort === 'tested') out.sort((a, b) => stamp(snapshots[b.id]?.last_seen) - stamp(snapshots[a.id]?.last_seen));
    if (sort === 'profiles') out.sort((a, b) => (used[b.id] ?? 0) - (used[a.id] ?? 0));
    return out;
}

/** Proxy id to how many profiles use it. */
export function usedByProxy(profiles: readonly ProfileMeta[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of profiles) if (p.proxy_id) out[p.proxy_id] = (out[p.proxy_id] ?? 0) + 1;
    return out;
}

/** The proxies the list shows, in its order: one answer for the table, the
 *  keys, a shift-click range and bulk actions. */
function listFor(s: Pick<ProxyStore, 'proxies' | 'snapshots' | 'search' | 'filters' | 'sort' | 'profiles'>): ProxyEntry[] {
    const used = usedByProxy(s.profiles);
    return sortProxies(filterProxies(s.proxies, s.snapshots, s.search, s.filters, used), s.sort, s.snapshots, used);
}

/** The ids of the proxies the list shows, in its order. */
export function visibleProxyIds(): string[] {
    return listFor(useProxy.getState()).map((p) => p.id);
}

/** The selected proxies the list shows: a filter that hides a selected one
 *  keeps it out of bulk actions. */
export function selectedVisibleIds(): string[] {
    const sel = useProxy.getState().proxySel;
    return visibleProxyIds().filter((id) => sel.has(id));
}

/** A test that failed, as a snapshot: the row and Peek then read "Failed" with
 *  the reason, instead of the last good result (LQ-01). The backend stores
 *  none today (backend B15). */
function failedSnapshot(prev: ProxyTestSnapshot | undefined, reason: string): ProxyTestSnapshot {
    const now = `@${Math.floor(Date.now() / 1000)}`;
    return {
        first_seen: now, last_seen: now, ip: "", country_code: "", country: "", region: "", city: "", isp: "",
        timezone: "", latitude: 0, longitude: 0, tcp_ms: null, udp_ms: null, udp_error: null,
        geo_error: reason, provider: prev?.provider ?? "",
    };
}

export type ProxyStore = {

    status: 'idle' | 'loading' | 'ready' | 'error';
    error: string | null;

    proxyTesting: Record<string, boolean>,
    proxies: ProxyEntry[],
    snapshots: Record<string, ProxyTestSnapshot>,
    proxySel: Set<string>,
    /** The Profiles store's own list (the same array), kept in step by
     *  src/app/wireStores.ts: this entity cannot import that store. */
    profiles: ProfileMeta[],

    // UI state lives in the store so feature buttons stay prop-free.
    bulkOpen: boolean,
    search: string,
    /// Row the last plain click landed on; a shift-click selects the run from it.
    anchorId: string | null,
    /// The row the keyboard acts on.
    activeId: string | null,
    /// The pointer passing over it made `activeId` active: the keys act on
    /// it, but the palette's first group does not (Pair 44 ruling).
    activeByPointer: boolean,
    /// The proxy Peek shows, or null when Peek is closed.
    peekId: string | null,
    /// Proxies that just arrived (Add proxies, an import, another window),
    /// with the time they did: each row slides in once (Live layer, spec
    /// 6.2), as a new profile's does, and loses its mark once it has played.
    arrived: Record<string, number>,
    /** The Filters menu's choices; not saved. */
    filters: ProxyFilters,
    setFilters: (patch: Partial<ProxyFilters>) => void,
    clearFilters: () => void,
    /** Display's order; saved. */
    sort: ProxySort,
    setSort: (sort: ProxySort) => void,

    init: () => Promise<void>,
    /** Reads the last test of each of `ids` this store does not have yet,
     *  at most LAST_TEST_LIMIT at a time; each is read once per session (a
     *  never-tested proxy too). Other pages' results are reused. */
    loadLastTests: (ids: string[]) => Promise<void>,
    /** `quiet` leaves the list alone: a bulk run reloads once at its end, not once per proxy. */
    testProxy: (p: ProxyEntry, quiet?: boolean) => Promise<'error' | 'ok'>,
    reload: () => Promise<void>,
    setProxies: (proxies: ProxyEntry[]) => void,
    setSnapshots: (snapshots: Record<string, ProxyTestSnapshot>) => void,
    selectProxy: (isChecked: boolean, proxies: ProxyEntry[]) => void,
    /** Shift-click: selects every row between the anchor and `id`. */
    selectRangeTo: (id: string) => void,
    clearSelected: () => void,
    /** Selects every row the list shows. */
    selectAll: () => void,
    toggleSelect: (id: string) => void,
    /** `pointer`: the pointer passing over the row made it active, nothing else. */
    setActive: (id: string | null, opts?: { pointer?: boolean }) => void,
    /** Moves the active row; from none, a step down or "first" lands on the first row. */
    moveActive: (to: number | 'first' | 'last') => void,
    openPeek: (id: string) => void,
    closePeek: () => void,
    togglePeek: (id: string) => void,

    setBulkOpen: (open: boolean) => void,
    setSearch: (q: string) => void,

    /** Saves Peek's edit quietly; false when it failed (the error is shown). */
    saveProxy: (entry: ProxyEntry) => Promise<boolean>,
    reloadProxies: () => Promise<void>,
    renameProxy: (id: string, name: string) => Promise<void>,
    removeProxy: (id: string) => Promise<void>,
    /** Tests the given proxies, or the selection the list shows. */
    bulkTest: (ids?: string[]) => Promise<void>,
    /** Deletes the given proxies, or the selection the list shows, behind an Undo toast. */
    bulkDelete: (ids?: string[]) => Promise<void>,
    /** Copies the given proxies, or the selection the list shows, in the import format. */
    bulkExport: (ids?: string[]) => void,
    bulkImportClipboard: () => Promise<void>,
}
/** About the rows of a tall window: their test results load first. */
const FIRST_SCREEN = 40;
/** The rest load in groups, one store update each, a frame apart. */
const GROUP = 100;

/// The proxies' last test results: the rows the list shows first, then the
/// rest in groups after the first paint (PERF-21). One call per proxy until
/// the backend has a batch command (B11).
async function loadSnapshots(set: (p: Partial<ProxyStore>) => void, get: () => ProxyStore) {
    const order = visibleProxyIds();
    const listed = new Set(order);
    const ids = [...order, ...get().proxies.map((p) => p.id).filter((id) => !listed.has(id))];
    const load = async (group: string[]) => {
        const found = await Promise.all(group.map(async (id) => [id, await proxyLastTest(id).catch(() => null)] as const));
        const next = { ...get().snapshots };
        let changed = false;
        // A result a test already stored is newer than the last saved one.
        for (const [id, snap] of found) if (snap && !next[id]) { next[id] = snap; changed = true; }
        if (changed) set({ snapshots: next });
    };
    await load(ids.slice(0, FIRST_SCREEN));
    for (let i = FIRST_SCREEN; i < ids.length; i += GROUP) {
        // A timer, not requestAnimationFrame: a window in the tray paints no frames.
        await new Promise((r) => setTimeout(r, 16));
        await load(ids.slice(i, i + GROUP));
    }
}

/** At most this many last-test reads in flight for `loadLastTests`: the
 *  Profiles page's action cards read them in the background. */
const LAST_TEST_LIMIT = 4;
/** Proxies whose last test was read (or is being read), so none is read twice. */
const lastTestRead = new Set<string>();
/** The bus listener goes on with the first list, once. */
let listening = false;

export const useProxy = create<ProxyStore>((set, get) => ({
    status: 'idle',
    error: null,
    proxyTesting: {},
    proxies: new Array<ProxyEntry>(),
    snapshots: {},
    proxySel: new Set<string>(),
    profiles: new Array<ProfileMeta>(),
    bulkOpen: false,
    search: '',
    anchorId: null,
    activeId: null,
    activeByPointer: false,
    peekId: null,
    arrived: {},
    filters: emptyProxyFilters(),
    setFilters: (patch) => set({ filters: { ...get().filters, ...patch } }),
    clearFilters: () => set({ filters: emptyProxyFilters() }),
    sort: loadSort(),
    setSort: (sort) => {
        try { localStorage.setItem(SORT_KEY, sort); } catch { /* private mode */ }
        set({ sort });
    },
    testProxy: async (p: ProxyEntry, quiet?: boolean) => {
        set({ proxyTesting: { ...get().proxyTesting, [p.id]: true } });
        try {
            const snap = await proxyFullTest(p);
            set({ snapshots: { ...get().snapshots, [p.id]: snap } });
            // Refresh: backend may have just populated the country tag. A
            // bulk run does this once at the end instead — reloading the
            // whole list after every proxy was most of the wait on a long one.
            if (!quiet) get().reload();
            return proxyStatus(snap) === 'ok' ? 'ok' : 'error';
        } catch (e) {
            set({ snapshots: { ...get().snapshots, [p.id]: failedSnapshot(get().snapshots[p.id], String(e)) } });
            return 'error';
        } finally {
            // Cleanup only: a `return` here would turn every failure into 'ok'.
            set({ proxyTesting: { ...get().proxyTesting, [p.id]: false } });
        }
    },
    loadLastTests: async (ids) => {
        const todo = ids.filter((id) => !(id in get().snapshots) && !lastTestRead.has(id));
        for (const id of todo) lastTestRead.add(id);
        // Results reach the store in groups, not one update each.
        let found: [string, ProxyTestSnapshot][] = [];
        const flush = () => {
            if (found.length === 0) return;
            const next = { ...get().snapshots };
            // A result a test (or the Proxies page) already stored is as new or newer.
            for (const [id, snap] of found) if (!next[id]) next[id] = snap;
            found = [];
            set({ snapshots: next });
        };
        let at = 0;
        const worker = async () => {
            while (at < todo.length) {
                const id = todo[at++];
                try {
                    const snap = await proxyLastTest(id);
                    if (snap) found.push([id, snap]);
                    if (found.length >= LAST_TEST_LIMIT) flush();
                } catch {
                    // Not read: a later pass asks again.
                    lastTestRead.delete(id);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(LAST_TEST_LIMIT, todo.length) }, worker));
        flush();
    },
    init: async () => {
        // Guard against a second start.
        if (get().status === 'loading' || get().status === 'ready') return;
        set({ status: 'loading' });
        try {
            // One call: the profiles come from the Profiles store (src/app/wireStores.ts, PERF-21).
            const proxies = (await proxyList()).filter((p) => !pendingProxyIds.has(p.id));
            set({ proxies, status: 'ready' });
            // A proxy saved here is already in this list: only another store's change reloads it.
            // Once: a new space starts the list over.
            if (!listening) {
                listening = true;
                storeBus.on('proxies', (from) => { if (from !== 'proxies') void get().reloadProxies(); });
            }
            await loadSnapshots(set, get);
        } catch (e) {
            set({ status: 'error', error: String(e) });
        }
    },
    // The profiles need no reading: the Profiles store's list is this one (wireStores.ts).
    reload: async () => { await get().reloadProxies(); },
    reloadProxies: async () => {
        // Once the list is in, a proxy the next read has and this one lacks
        // is new: added here, imported, or from another window.
        const had = get().status === 'ready' ? new Set(get().proxies.map((p) => p.id)) : null;
        try {
            // One waiting behind its Undo toast stays hidden.
            const proxies = (await proxyList()).filter((p) => !pendingProxyIds.has(p.id));
            // A proxy deleted elsewhere leaves the selection too.
            const ids = new Set(proxies.map((p) => p.id));
            const kept = [...get().proxySel].filter((id) => ids.has(id));
            set({ proxies, ...(kept.length !== get().proxySel.size ? { proxySel: new Set(kept) } : {}) });
            if (had) markArrived(() => get().arrived, (arrived) => set({ arrived }), proxies.filter((p) => !had.has(p.id) && !comingBack.has(p.id)).map((p) => p.id));
        } catch (e) { toast.fail({ title: t("useProxy.refreshFailed"), detail: e }); }
    },
    saveProxy: async (entry) => {
        // A team's rules first: a new one needs Create in the team, a change Edit on it.
        const known = !!entry.id && get().proxies.some((p) => p.id === entry.id);
        const refused = known ? teamRefusal('edit', onProxy(entry.id)) : teamRefusal('create');
        if (refused) { toast.fail({ title: t("useProxy.saveFailed", { name: entry.name }), detail: refused, subject: entry.name }); return false; }
        try {
            const saved = await proxySave(entry);
            set({ proxies: get().proxies.map((p) => (p.id === saved.id ? saved : p)) });
            // The Profiles list and the proxy pickers show it too.
            storeBus.emit('proxies', 'proxies');
            return true;
        } catch (e) {
            toast.fail({ title: t("useProxy.saveFailed", { name: entry.name }), detail: e, subject: entry.name });
            return false;
        }
    },
    setProxies: (proxies: ProxyEntry[]) => set({ proxies }),
    setSnapshots: (snapshots: Record<string, ProxyTestSnapshot>) => set({ snapshots }),
    selectProxy: (isChecked: boolean, proxies: ProxyEntry[]) => {
        const next = new Set(get().proxySel);
        if (isChecked) {
            for (const p of proxies) next.add(p.id);
        } else {
            for (const p of proxies) next.delete(p.id);
        }
        const single = proxies.length === 1 ? proxies[0].id : null;
        set({ proxySel: next, anchorId: single ?? get().anchorId });
    },
    // Runs over the list as the table orders it. The row you click decides the
    // direction: a ticked one unticks the run, an unticked one ticks it.
    selectRangeTo: (id: string) => {
        const order = listFor(get()).map((p) => p.id);
        const to = order.indexOf(id);
        if (to < 0) return;
        const anchor = get().anchorId;
        // Only a still-ticked anchor has a run to extend; see useProfile.
        const from = anchor && get().proxySel.has(anchor) ? order.indexOf(anchor) : -1;
        if (from < 0) {
            const row = get().proxies.filter((p) => p.id === id);
            get().selectProxy(!get().proxySel.has(id), row);
            return;
        }
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        const removing = get().proxySel.has(id);
        const next = new Set(get().proxySel);
        for (let i = lo; i <= hi; i++) {
            if (removing) next.delete(order[i]); else next.add(order[i]);
        }
        set({ proxySel: next });
    },
    clearSelected: () => set({ proxySel: new Set<string>(), anchorId: null }),
    selectAll: () => set({ proxySel: new Set(visibleProxyIds()) }),
    toggleSelect: (id) => {
        const row = get().proxies.filter((p) => p.id === id);
        get().selectProxy(!get().proxySel.has(id), row);
    },
    setActive: (activeId, opts) => {
        const activeByPointer = opts?.pointer === true;
        if (get().activeId !== activeId || get().activeByPointer !== activeByPointer) set({ activeId, activeByPointer });
    },
    moveActive: (to) => {
        const order = visibleProxyIds();
        if (order.length === 0) return;
        const at = get().activeId ? order.indexOf(get().activeId!) : -1;
        let next: number;
        if (to === 'first') next = 0;
        else if (to === 'last') next = order.length - 1;
        else if (at < 0) next = to > 0 ? 0 : order.length - 1;
        else next = Math.min(Math.max(at + to, 0), order.length - 1);
        set({ activeId: order[next], activeByPointer: false });
    },
    openPeek: (id) => set({ peekId: id, activeId: id, activeByPointer: false }),
    closePeek: () => set({ peekId: null }),
    togglePeek: (id) => (get().peekId === id ? get().closePeek() : get().openPeek(id)),

    setBulkOpen: (bulkOpen) => set({ bulkOpen }),
    setSearch: (search) => set({ search }),

    renameProxy: async (id, name) => {
        const entry = get().proxies.find((p) => p.id === id);
        if (!entry) return;
        const newName = name.trim();
        if (newName === entry.name) return;
        const refused = teamRefusal('edit', onProxy(id));
        if (refused) { toast.fail({ title: t("useProxy.renameFailed", { name: entry.name }), detail: refused, subject: entry.name }); return; }
        try {
            await proxySave({ ...entry, name: newName });
            get().reload();
            storeBus.emit('proxies', 'proxies');
        } catch (e) { toast.fail({ title: t("useProxy.renameFailed", { name: entry.name }), detail: e, subject: entry.name }); }
    },
    removeProxy: async (id) => {
        const entry = get().proxies.find((p) => p.id === id);
        if (!entry) return;
        deleteProxies(get, set, [entry]);
    },
    // Capped-parallel bulk TCP/UDP/geo to avoid socket fan-out.
    bulkTest: async (given) => {
        const { proxies, testProxy } = get();
        const ids = given ?? selectedVisibleIds();
        if (ids.length === 0) return;
        toast.info(ids.length === 1 ? t("useProxy.testingOne", { n: ids.length }) : t("useProxy.testingMany", { n: ids.length }));
        const wanted = new Set(ids);
        const targets = proxies.filter((p) => wanted.has(p.id));
        const CONCURRENCY = 5;
        let i = 0;
        let ok = 0;
        await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
                while (i < targets.length) {
                    const p = targets[i++];
                    if (!p) break;
                    if ((await testProxy(p, true)) === 'ok') ok++;
                }
            }),
        );
        // Once, now that every test is in: the backend may have filled in
        // country tags along the way.
        get().reload();
        // What happened, not just that it ended (LQ-01, LQ-02).
        const failed = targets.length - ok;
        const summary = t("useProxy.testedSummary", { n: targets.length, ok, failed });
        if (failed === 0) toast.ok(summary);
        else toast.info(summary);
    },
    bulkDelete: async (given) => {
        const ids = given ?? selectedVisibleIds();
        if (ids.length === 0) return;
        // In the order given (the list's), as the deletes run.
        const byId = new Map(get().proxies.map((p) => [p.id, p]));
        deleteProxies(get, set, ids.flatMap((id) => byId.get(id) ?? []));
    },
    // Export in bulk-import format so a round-trip preserves the name.
    bulkExport: (given) => {
        const wanted = new Set(given ?? selectedVisibleIds());
        const targets = get().proxies.filter((p) => wanted.has(p.id));
        if (targets.length === 0) return;
        const lines = targets.map((p) => {
            const auth = p.username || p.password ? `${p.username}:${p.password}@` : "";
            const base = `${p.kind}://${auth}${p.host}:${p.port}`;
            // Only the name: the country is derived by the test on import, so
            // writing it down would just be a second copy to go stale.
            const named = p.name && p.name !== `${p.host}:${p.port}`;
            return named ? `${base}  # ${p.name}` : base;
        });
        const text = lines.join("\n");
        // Lines with credentials leave the clipboard after a minute (SEC-11).
        const secret = targets.some((p) => p.username || p.password);
        (secret ? copySecret(text) : clip.write(text)).then(
            () => toast.ok(
                targets.length === 1 ? t("useProxy.copiedOne") : t("useProxy.copiedMany", { n: targets.length }),
                secret ? { detail: t("clipboard.clearsSoon") } : undefined,
            ),
            (e) => toast.fail({ title: t("useProxy.copyFailed"), detail: e }),
        );
    },
    // Import from clipboard (one per line, bulkExport format).
    bulkImportClipboard: async () => {
        const refused = teamRefusal('create');
        if (refused) { toast.fail({ title: t("useProxy.importFailed"), detail: refused }); return; }
        try {
            const text = await clip.read();
            if (!text.trim()) { toast.err(t("useProxy.clipboardEmpty")); return; }
            const tooBig = clipboardTooBig(text);
            if (tooBig) { toast.err(tooBig); return; }
            const n = await proxyBulkImport(text, "socks5");
            get().reload();
            storeBus.emit('proxies', 'proxies');
            toast.ok(n === 1 ? t("useProxy.importedOne", { n }) : t("useProxy.importedMany", { n }));
        } catch (e) { toast.fail({ title: t("useProxy.importFailed"), detail: e }); }
    },
}))

// Another space: its proxies are read afresh; nothing picked or open in the old one stays.
onSpaceMoved(() => {
    const was = useProxy.getState().status;
    useProxy.setState({
        status: 'idle', error: null, proxies: [], proxySel: new Set<string>(), anchorId: null, activeId: null,
        activeByPointer: false, peekId: null, arrived: {}, bulkOpen: false, proxyTesting: {},
    });
    if (was !== 'idle') void useProxy.getState().init();
});

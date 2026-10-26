import { create } from "zustand";
import { toast } from "../../../shared/model/toast";
import { reportLoadError } from "../../../shared/model/loadError";
import { deferDelete, isPendingDelete } from "../../../shared/lib/deferDelete";
import { onSpaceMoved } from "../../../shared/api/invoke";
import { t } from "../../../shared/i18n";
import {
  automationAvailable,
  automationCreate,
  automationDelete,
  automationDuplicate,
  automationList,
  automationSave,
} from "../model/api";
import type { Block, Project } from "../model/types";
import { tidyBlocks } from "./layout";
import { teamRefusal } from "../../space";

// A project deleted behind its Undo toast stays out of every read until the toast goes.
const living = (projects: Project[]) => projects.filter((p) => !isPendingDelete(`project:${p.id}`));

// The project as it was when a drag began: the drag moves it locally on every
// frame, so the version before it would otherwise be lost to Undo.
let dragBase: Project | null = null;

/** The last version sent, and what the backend answered for it. */
type Sent = { sent: Project; stored: Project };
type Waiting = { resolve: (done: Sent) => void; reject: (error: unknown) => void };
const saving = new Map<string, { next: Project | null; waiting: Waiting[] }>();

/// One save per project at a time (controller ruling, Pair 21): the single
/// sender behind Save. The backend may answer two saves in either order, so
/// two sent at once could land the older version last and keep it. While a
/// save is out, only the newest version waits (each is the whole project, so
/// it carries every change before it); it goes when the first answers, and
/// every caller gets the answer to the last one sent, with that version, so
/// no caller builds the saved project from its own older one.
async function saveInTurn(project: Project): Promise<Sent> {
  const out = saving.get(project.id);
  if (out) {
    out.next = project;
    return new Promise((resolve, reject) => out.waiting.push({ resolve, reject }));
  }
  const turn = { next: null as Project | null, waiting: [] as Waiting[] };
  saving.set(project.id, turn);
  let sending: Project | null = project;
  let result: { done: Sent } | { error: unknown } = { error: null };
  while (sending) {
    const sent: Project = sending;
    try { result = { done: { sent, stored: (await automationSave(sent)) ?? sent } }; }
    catch (e) { result = { error: e }; }
    // The waiting version was made over the one just stored: it carries that revision.
    sending = turn.next && "done" in result ? rebased(turn.next, result.done.stored.revision) : turn.next;
    turn.next = null;
  }
  saving.delete(project.id);
  for (const w of turn.waiting) {
    if ("done" in result) w.resolve(result.done);
    else w.reject(result.error);
  }
  if ("done" in result) return result.done;
  throw result.error;
}

/// Two versions of a project hold the same content. `updated_at` is the
/// backend's stamp on a save, not something the user changed; a key set to
/// nothing is the same as no key (a cleared optional setting).
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bs = b as unknown[];
    return a.length === bs.length && a.every((x, i) => same(x, bs[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!same(ao[k], bo[k])) return false;
  return true;
}
// `revision` is the team's count of saves, not content either.
const sameProject = (a: Project, b: Project) => same({ ...a, updated_at: 0, revision: 0 }, { ...b, updated_at: 0, revision: 0 });

/** `p` over a team's revision `revision`; as it is where there is none (the personal space). */
function rebased(p: Project, revision: number | undefined): Project {
  return revision === undefined || p.revision === revision ? p : { ...p, revision };
}

function without(drafts: Record<string, Project>, id: string): Record<string, Project> {
  const rest = { ...drafts };
  delete rest[id];
  return rest;
}

/** `next` as the project's draft: none when it matches the saved project,
 *  so a change typed back to what is saved leaves nothing to save, and a
 *  failed save's words go with the changes they were about. */
/** Without Edit in the team its projects only open to read. */
const viewOnly = () => !!teamRefusal("edit");

function withDraft(
  s: { projects: Project[]; drafts: Record<string, Project>; saveError: { id: string; message: string } | null },
  id: string, next: Project,
): { drafts: Record<string, Project>; saveError?: null } {
  const saved = s.projects.find((p) => p.id === id);
  const rest = without(s.drafts, id);
  if (!saved || sameProject(saved, next)) return { drafts: rest, ...(s.saveError?.id === id ? { saveError: null } : {}) };
  return { drafts: { ...rest, [id]: next } };
}

export type AutomationStore = {
  status: "idle" | "loading" | "ready" | "error";
  /** Why the first load failed. */
  error: string | null;
  /** False on a build compiled without the automation feature. */
  available: boolean;
  projects: Project[];
  openId: string | null;
  /** The editor opens with the name field selected, for typing the name (a new project, Rename). */
  focusName: boolean;
  busy: string | null;
  /** Snapshots of a project before each change, newest last. */
  past: Project[];
  future: Project[];
  /** Changes not yet saved, by project id (manual save, owner 2026-10-07).
   *  `projects` holds what is saved; a project with no draft is unchanged. */
  drafts: Record<string, Project>;
  /** The project whose Save is out. */
  saving: string | null;
  /** Why the last Save of a project failed, shown beside its Save button. */
  saveError: { id: string; message: string } | null;

  init: () => Promise<void>;
  reload: () => Promise<void>;
  open: (id: string | null) => void;
  /** Opens the editor with the name field selected. */
  openToRename: (id: string) => void;
  /** The editor took the selection; it does not take it again. */
  nameFocused: () => void;
  create: (name: string) => Promise<void>;
  rename: (p: Project, name: string) => Promise<void>;
  remove: (p: Project) => Promise<void>;
  duplicate: (p: Project) => Promise<void>;
  patch: (id: string, next: Partial<Project>) => Promise<void>;
  addBlock: (id: string, block: Block, after?: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  moveBlock: (id: string, blockId: string, by: -1 | 1) => Promise<void>;
  placeBlock: (id: string, blockId: string, x: number, y: number) => void;
  /** Ends a drag: the moved positions are saved, as one Undo step. */
  commitMove: (id: string) => Promise<void>;
  /** Auto-layout over every step. Silent: no Undo step (the first layout of a new project). */
  tidy: (id: string, opts?: { silent?: boolean }) => Promise<void>;
  connect: (id: string, from: string, port: "done" | "fail", to: string | null) => Promise<void>;
  /** The open project as edited: its draft when it has one, else as saved. */
  current: () => Project | null;
  /** A project as edited: its draft, else as saved; null when it is gone. */
  edited: (id: string) => Project | null;
  isDirty: (id: string) => boolean;
  /** Sends the draft once; true when it is stored (or there was nothing to store). */
  save: (id: string) => Promise<boolean>;
  /** Drops the draft: the project is as saved again. */
  discard: (id: string) => void;
};

export const useAutomation = create<AutomationStore>((set, get) => ({
  status: "idle",
  error: null,
  available: false,
  projects: [],
  openId: null,
  focusName: false,
  busy: null,
  past: [],
  future: [],
  drafts: {},
  saving: null,
  saveError: null,

  init: async () => {
    if (get().status === "loading") return;
    // Already loaded: refresh in place, the list stays on screen.
    if (get().status === "ready") return get().reload();
    set({ status: "loading", error: null });
    try {
      const available = await automationAvailable();
      if (!available) {
        set({ available: false, projects: [], status: "ready" });
        return;
      }
      set({ available: true, projects: living(await automationList()), status: "ready" });
    } catch (e) {
      set({ status: "error", error: String(e) });
      reportLoadError("automation", t("useAutomation.loadFailed"), e);
    }
  },

  // A draft stays over a fresh list: what was typed is kept, and is
  // measured against the newly saved version. A project gone takes its
  // draft with it.
  reload: async () => {
    try {
      const projects = living(await automationList());
      set((s) => {
        const drafts: Record<string, Project> = {};
        for (const [id, d] of Object.entries(s.drafts)) {
          const saved = projects.find((p) => p.id === id);
          if (saved && !sameProject(saved, d)) drafts[id] = d;
        }
        return { projects, drafts };
      });
    }
    catch (e) { toast.fail({ title: t("useAutomation.refreshFailed"), detail: e }); }
  },

  // The Undo trail belongs to the open project: another one starts its own.
  open: (id) => set((s) => ({ openId: id, focusName: false, ...(id !== s.openId ? { past: [], future: [] } : {}) })),
  openToRename: (id) => set((s) => ({ openId: id, focusName: true, ...(id !== s.openId ? { past: [], future: [] } : {}) })),
  nameFocused: () => set({ focusName: false }),

  current: () => {
    const { openId } = get();
    return openId ? get().edited(openId) : null;
  },

  edited: (id) => {
    const { projects, drafts } = get();
    const saved = projects.find((p) => p.id === id);
    return saved ? drafts[id] ?? saved : null;
  },

  isDirty: (id) => id in get().drafts,

  // The whole project in one write, through the one sender. Changes made
  // while it is out stay a draft over what was stored. A failure keeps the
  // draft as typed and says why beside Save, never reloading over it.
  save: async (id) => {
    const draft = get().drafts[id];
    if (!draft) return true;
    // A team's projects change with Edit in the team: the draft stays as typed.
    const refused = teamRefusal("edit");
    if (refused) { set({ saveError: { id, message: refused } }); return false; }
    set({ saving: id, saveError: null });
    try {
      // The sent objects become the saved ones, with the backend's stamp:
      // what is on screen keeps its identity (an open rule's form stays open).
      // A team's next save names the revision this one made (verifier finding 4).
      const done = await saveInTurn(draft);
      const stored = rebased({ ...done.sent, updated_at: done.stored.updated_at }, done.stored.revision);
      set((s) => {
        const projects = s.projects.map((p) => (p.id === id ? stored : p));
        // Changes made while it was out sit over what it stored.
        const now = s.drafts[id] && s.drafts[id] !== draft ? rebased(s.drafts[id], stored.revision) : null;
        const rest = without(s.drafts, id);
        return {
          projects,
          drafts: now && !sameProject(stored, now) ? { ...rest, [id]: now } : rest,
          saving: null,
        };
      });
      toast.saved(t("projectEditor.saved"));
      return true;
    } catch (e) {
      set({ saving: null, saveError: { id, message: t("projectEditor.saveFailedKept") } });
      toast.fail({ title: t("useAutomation.saveFailed", { name: draft.name }), detail: e, subject: draft.name });
      return false;
    }
  },

  discard: (id) => {
    if (dragBase?.id === id) dragBase = null;
    set((s) => ({
      drafts: without(s.drafts, id),
      // Its Undo trail led through the dropped changes.
      past: s.past.filter((p) => p.id !== id),
      future: s.future.filter((p) => p.id !== id),
      saveError: s.saveError?.id === id ? null : s.saveError,
    }));
  },

  create: async (name) => {
    const refused = teamRefusal("create");
    if (refused) { toast.fail({ title: t("useAutomation.createFailed", { name }), detail: refused, subject: name }); return; }
    try {
      const p = await automationCreate(name);
      await get().reload();
      set({ openId: p.id, focusName: true });
    } catch (e) { toast.fail({ title: t("useAutomation.createFailed", { name }), detail: e, subject: name }); }
  },

  rename: async (p, name) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === p.name) return;
    await get().patch(p.id, { name: trimmed });
  },

  // Behind an Undo toast, nothing asked (ruling 18). An open project's
  // editor closes with it, and Undo opens it again.
  remove: async (p) => {
    // Refused by a team's rules: it never leaves the list, so it never comes back.
    const refused = teamRefusal("delete");
    if (refused) { toast.fail({ title: t("useAutomation.deleteFailed", { name: p.name }), detail: refused }); return; }
    let wasOpen = false;
    deferDelete({
      key: `project:${p.id}`,
      title: t("useAutomation.deleted", { name: p.name }),
      failTitle: t("useAutomation.deleteFailed", { name: p.name }),
      hide: () => {
        wasOpen = get().openId === p.id;
        set({ projects: get().projects.filter((x) => x.id !== p.id), drafts: without(get().drafts, p.id), ...(wasOpen ? { openId: null } : {}) });
      },
      restore: () => { void get().reload().then(() => { if (wasOpen && get().openId === null) set({ openId: p.id }); }); },
      commit: async () => { await automationDelete(p.id); await get().reload(); },
    });
  },

  duplicate: async (p) => {
    const refused = teamRefusal("create");
    if (refused) { toast.fail({ title: t("useAutomation.duplicateFailed", { name: p.name }), detail: refused, subject: p.name }); return; }
    set({ busy: p.id });
    try {
      const copy = await automationDuplicate(p.id);
      await get().reload();
      set({ openId: copy.id });
    } catch (e) { toast.fail({ title: t("useAutomation.duplicateFailed", { name: p.name }), detail: e, subject: p.name }); }
    finally { set({ busy: null }); }
  },

  // Every change goes to the draft; nothing is written until Save (manual
  // save, owner 2026-10-07). Save sends the whole project: the backend is the
  // single writer, so a partial update would need a merge on both sides.
  //
  // Each change also files the version before it, so a deletion can be taken
  // back. Bounded at 50: a long editing session should not hold every state
  // the project ever had.
  patch: async (id, next) => {
    // A team's project without Edit opens to read: no change takes (doors.rs automation_save).
    if (viewOnly()) { dragBase = null; return; }
    const base = dragBase?.id === id ? dragBase : null;
    dragBase = null;
    const live = get().edited(id);
    const before = base ?? live;
    if (!before || !live) return;
    const merged = { ...live, ...next };
    set((s) => ({
      ...withDraft(s, id, merged),
      past: [...s.past.slice(-49), before],
      // A new change makes the redo trail meaningless.
      future: [],
    }));
  },

  commitMove: async (id) => {
    const base = dragBase;
    const live = get().edited(id);
    if (!base || base.id !== id || !live) { dragBase = null; return; }
    const moved = live.blocks.some((b) => {
      const was = base.blocks.find((x) => x.id === b.id);
      return !was || was.x !== b.x || was.y !== b.y;
    });
    if (!moved) { dragBase = null; return; }
    await get().patch(id, {});
  },

  tidy: async (id, opts) => {
    const p = get().edited(id);
    if (!p) return;
    const blocks = tidyBlocks(p.blocks);
    if (opts?.silent) {
      // Not a change the user made, so nothing to save: the layout lands on
      // the project as held here, and is stored with the next Save.
      set((s) => ({
        projects: s.projects.map((x) => (x.id === id ? { ...x, blocks: tidyBlocks(x.blocks) } : x)),
        drafts: s.drafts[id] ? { ...s.drafts, [id]: { ...s.drafts[id], blocks } } : s.drafts,
      }));
      return;
    }
    await get().patch(id, { blocks });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  // Undo and Redo work on the draft. After a save they still go back: the
  // draft then differs from what is saved again, and Save says so.
  undo: async () => {
    if (viewOnly()) return;
    const past = get().past;
    const previous = past[past.length - 1];
    if (!previous) return;
    const current = get().edited(previous.id);
    if (!current) { set({ past: past.slice(0, -1) }); return; }
    // A step back is a change over what is held now: it keeps today's revision.
    set((s) => ({
      past: past.slice(0, -1),
      future: [...s.future, current],
      ...withDraft(s, previous.id, rebased(previous, current.revision)),
    }));
  },

  redo: async () => {
    if (viewOnly()) return;
    const future = get().future;
    const nextOne = future[future.length - 1];
    if (!nextOne) return;
    const current = get().edited(nextOne.id);
    if (!current) { set({ future: future.slice(0, -1) }); return; }
    set((s) => ({
      future: future.slice(0, -1),
      past: [...s.past, current],
      ...withDraft(s, nextOne.id, rebased(nextOne, current.revision)),
    }));
  },

  // Order matters more here than in a flat list: a jump target is a step id,
  // so moving a step keeps every branch pointing where it did.
  moveBlock: async (id, blockId, by) => {
    const p = get().edited(id);
    if (!p) return;
    const at = p.blocks.findIndex((b) => b.id === blockId);
    const to = at + by;
    if (at < 0 || to < 0 || to >= p.blocks.length) return;
    const blocks = [...p.blocks];
    [blocks[at], blocks[to]] = [blocks[to], blocks[at]];
    await get().patch(id, { blocks });
  },

  // Dragging is continuous, so the move lands on the draft on every frame and
  // becomes one Undo step once the pointer is released.
  placeBlock: (id, blockId, x, y) => {
    const p = get().edited(id);
    if (!p || viewOnly()) return;
    if (dragBase?.id !== id) dragBase = p;
    set((s) => withDraft(s, id, { ...p, blocks: p.blocks.map((b) => (b.id === blockId ? { ...b, x, y } : b)) }));
  },

  connect: async (id, from, port, to) => {
    const p = get().edited(id);
    if (!p) return;
    const which = port === "done" ? "on_done" : "on_fail";
    // Dropping a wire on empty space means "cut this link" — end the branch
    // here. (It used to fall back to "next" for the done port, which silently
    // re-attached the step to whatever sat below it, so a link could not be
    // cut at all.)
    await get().patch(id, {
      blocks: p.blocks.map((b) =>
        b.id === from ? { ...b, [which]: to ? { goto: to } : "stop" } : b,
      ),
    });
  },

  addBlock: async (id, block, after) => {
    const p = get().edited(id);
    if (!p) return;
    const blocks = [...p.blocks];
    const at = after ? blocks.findIndex((b) => b.id === after) : -1;
    // A new step lands after the one it was recorded against, or at the end.
    blocks.splice(at >= 0 ? at + 1 : blocks.length, 0, block);
    await get().patch(id, { blocks });
  },
}));

// Another space: its projects are read afresh; the old one's editor and changes close with it.
onSpaceMoved(() => {
  const was = useAutomation.getState().status;
  useAutomation.setState({
    status: "idle", error: null, projects: [], openId: null, focusName: false, busy: null,
    past: [], future: [], drafts: {}, saving: null, saveError: null,
  });
  if (was !== "idle") void useAutomation.getState().init();
});

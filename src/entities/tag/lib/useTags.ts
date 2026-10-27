import { create } from "zustand";
import { LABEL_COLORS, type LabelColorId, type TagColor } from "../../../shared/constants";
import { handOver, windowStorage } from "../../../shared/lib/handOver";
import { writeQueue } from "../../../shared/lib/writeQueue";
import { onSpaceMoved } from "../../../shared/api/invoke";
import { toast } from "../../../shared/model/toast";
import { t } from "../../../shared/i18n";
import type { Tag } from "../model/types";
import { tagAssign, tagDelete, tagImport, tagList, tagSave } from "../model/api";
import { fromLegacy, whole } from "./stored";
import { teamRefusal } from "../../space";

/** Which of these profiles a team lets this person tag (Edit on each), and why not the rest.
 *  The profile store says (it holds the rows); everyone may, until it does. */
type AssignGuard = (profileIds: string[]) => { refused: string[]; reason: string | null };
let assignGuard: AssignGuard = () => ({ refused: [], reason: null });
export function setTagAssignGuard(fn: AssignGuard): void { assignGuard = fn; }

/** A tag a team's server saved under another id than sent (tag_save in a team): the new one. */
const renamed = new Map<string, string>();
const finalId = (id: string) => renamed.get(id) ?? id;
const remapped = (byProfile: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(byProfile).map(([pid, ids]) => [pid, ids.map(finalId)]));

/// Tags, and tag ids by profile id. The backend keeps them (tags.rs); this
/// store shows each change at once and sends it after.
/** Where builds before the backend kept them, handed over once. */
const LEGACY_KEY = "shardx.tags";
/** Longest tag name; a chip has to stay a chip. */
export const TAG_NAME_MAX = 32;

const COLOR_IDS = LABEL_COLORS.map((c) => c.id) as readonly string[];

/** The color a new tag gets when none is chosen: the next palette color in
 *  turn. */
export function nextTagColor(tags: readonly Pick<Tag, "color">[]): LabelColorId {
  return COLOR_IDS[tags.length % COLOR_IDS.length] as LabelColorId;
}

/** The changed profiles' whole lists, as `tag_assign` takes them: an empty list clears one. */
function changedLists(before: Record<string, string[]>, after: Record<string, string[]>, ids: Iterable<string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const pid of ids) {
    const next = after[pid] ?? [];
    const prev = before[pid] ?? [];
    if (next.length !== prev.length || next.some((x, i) => x !== prev[i])) out[pid] = next;
  }
  return out;
}

/** Trims, collapses internal whitespace and caps the length: the one
 *  normaliser a tag name goes through (the TagPicker cleans its query the
 *  same way before it compares, PC-085). */
export const clean = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, TAG_NAME_MAX);
const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
/** Whether another tag than `exceptId` already has this name (any case). */
export const tagNameTaken = (tags: readonly Tag[], name: string, exceptId?: string) =>
  tags.some((t) => t.id !== exceptId && same(t.name, clean(name)));
const newId = () => `t-${Math.random().toString(36).slice(2, 10)}`;

export type TagStore = {
  tags: Tag[];
  byProfile: Record<string, string[]>;
  /** Reads the tags from the backend once, after handing it the copy a
   *  build before it kept here. Never rejects: a failure is shown. */
  load: () => Promise<void>;
  /** Reads them again (a change made elsewhere, another space). Never rejects. */
  reload: () => Promise<void>;
  /** A new tag, or the one that already has this name (any case). Null for an empty name. */
  create: (name: string, color?: TagColor) => Tag | null;
  /** False when the name is empty or another tag has it. */
  rename: (id: string, name: string) => boolean;
  recolor: (id: string, color: TagColor) => void;
  /** Deletes the tag and takes it off every profile. */
  remove: (id: string) => void;
  /** Puts a deleted tag back with the profiles it was on (Undo), at its old place in the list;
   *  a tag made since with its name gets those profiles instead. */
  restoreTag: (tag: Tag, byProfile: Record<string, string[]>, at?: number) => void;
  /** Gives the tag to every profile, or takes it off all when all have it. */
  toggle: (profileIds: string[], tagId: string) => void;
  /** Takes one tag off one profile. */
  untag: (profileId: string, tagId: string) => void;
  /** Gives one profile exactly these tags (the profile form's Save). */
  setTags: (profileId: string, tagIds: string[]) => void;
  /** Drops the tags of profiles deleted for good. */
  forgetProfiles: (profileIds: string[]) => void;
  /** A profile got another id (one being created got its real one): its tags follow. */
  moveProfile: (from: string, to: string) => void;
};

let loading: Promise<void> | null = null;

export const useTags = create<TagStore>((set, get) => {
  let queue: ReturnType<typeof writeQueue> | null = null;
  const read = async () => {
    const s = await tagList();
    set(whole(s.tags, s.by_profile, COLOR_IDS));
    // A change made while this read was out shows again after it is sent.
    queue?.shown();
  };
  const load = () => loading ??= (async () => {
    try {
      await handOver(windowStorage(), [LEGACY_KEY], (raw) => tagImport(fromLegacy(raw[LEGACY_KEY], COLOR_IDS)));
      await read();
    } catch (e) {
      toast.fail({ title: t("useTags.loadFailed"), detail: e });
    }
  })();
  // Sent after the first read, in order: a change can never land before the handed-over copy.
  const send = (call: () => Promise<unknown>) => {
    queue ??= writeQueue(load(), (e) => toast.fail({ title: t("useTags.saveFailed"), detail: e }), read);
    void queue(call);
  };
  /** Shows the new lists and sends the profiles whose list changed. A profile a
   *  team does not let this person tag keeps its list, and the toast says why. */
  const assign = (wanted: Record<string, string[]>, touched: Iterable<string>) => {
    const asked = [...touched];
    const { refused, reason } = assignGuard(asked);
    const byProfile = { ...wanted };
    for (const pid of refused) {
      const had = get().byProfile[pid];
      if (had) byProfile[pid] = had; else delete byProfile[pid];
    }
    if (refused.length > 0) toast.fail({ title: t("useTags.saveFailed"), detail: reason });
    const changes = changedLists(get().byProfile, byProfile, asked.filter((pid) => !refused.includes(pid)));
    set({ byProfile });
    // Ids read as it goes: a tag the team saved under another id is sent by that one.
    if (Object.keys(changes).length) send(() => tagAssign(remapped(changes)));
  };
  /** A team's server answered a new tag with its own id: everything that names it follows. */
  const settleId = (sent: Tag, saved: Tag | null | undefined) => {
    if (!saved?.id || saved.id === sent.id) return;
    renamed.set(sent.id, saved.id);
    set({
      tags: get().tags.map((x) => (x.id === sent.id ? { ...x, id: saved.id } : x)),
      byProfile: Object.fromEntries(Object.entries(get().byProfile).map(([pid, ids]) => [pid, ids.map((x) => (x === sent.id ? saved.id : x))])),
    });
  };
  /** Why a team does not take this tag change, said once; null when it does. */
  const refuse = (action: "create" | "edit" | "delete"): boolean => {
    const why = teamRefusal(action);
    if (why) toast.fail({ title: t("useTags.saveFailed"), detail: why });
    return !!why;
  };
  return {
    tags: [],
    byProfile: {},
    load,
    reload: async () => {
      await load();
      try { await read(); } catch (e) { toast.fail({ title: t("useTags.loadFailed"), detail: e }); }
    },
    create: (name, color) => {
      const n = clean(name);
      if (!n) return null;
      const existing = get().tags.find((t) => same(t.name, n));
      if (existing) return existing;
      if (refuse("create")) return null;
      const tag: Tag = { id: newId(), name: n, color: color ?? nextTagColor(get().tags) };
      set({ tags: [...get().tags, tag] });
      // A team lists its tags by name and may answer another id: the reply's is kept.
      send(async () => settleId(tag, await tagSave(tag)));
      return tag;
    },
    rename: (id, name) => {
      const n = clean(name);
      if (!n || tagNameTaken(get().tags, n, id)) return false;
      const tag = get().tags.find((t) => t.id === id);
      if (!tag) return false;
      if (refuse("edit")) return false;
      const next = { ...tag, name: n };
      set({ tags: get().tags.map((t) => (t.id === id ? next : t)) });
      send(() => tagSave(next));
      return true;
    },
    recolor: (id, color) => {
      const tag = get().tags.find((t) => t.id === id);
      if (!tag) return;
      if (refuse("edit")) return;
      const next = { ...tag, color };
      set({ tags: get().tags.map((t) => (t.id === id ? next : t)) });
      send(() => tagSave(next));
    },
    remove: (id) => {
      if (refuse("delete")) return;
      const byProfile: Record<string, string[]> = {};
      for (const [pid, ids] of Object.entries(get().byProfile)) {
        const kept = ids.filter((x) => x !== id);
        if (kept.length) byProfile[pid] = kept;
      }
      set({ tags: get().tags.filter((t) => t.id !== id), byProfile });
      send(() => tagDelete(id));
    },
    restoreTag: (tag, byProfile, at) => {
      // A tag made since under its name takes its profiles: no two tags share a name.
      const twin = get().tags.find((x) => x.id !== tag.id && same(x.name, tag.name));
      if (!twin) {
        if (refuse("create")) return;
        const tags = [...get().tags];
        if (!tags.some((x) => x.id === tag.id)) tags.splice(at ?? tags.length, 0, tag);
        set({ tags });
        send(async () => settleId(tag, await tagSave(tag, at)));
      }
      const back = twin?.id ?? tag.id;
      const merged = { ...get().byProfile };
      const touched: string[] = [];
      for (const [pid, ids] of Object.entries(byProfile)) {
        if (!ids.includes(tag.id)) continue;
        merged[pid] = [...new Set([...(merged[pid] ?? []), back])];
        touched.push(pid);
      }
      assign(merged, touched);
    },
    toggle: (profileIds, tagId) => {
      const cur = get().byProfile;
      const all = profileIds.every((pid) => cur[pid]?.includes(tagId));
      const byProfile = { ...cur };
      for (const pid of profileIds) {
        const ids = cur[pid] ?? [];
        const next = all ? ids.filter((x) => x !== tagId) : ids.includes(tagId) ? ids : [...ids, tagId];
        if (next.length) byProfile[pid] = next; else delete byProfile[pid];
      }
      assign(byProfile, profileIds);
    },
    untag: (profileId, tagId) => {
      const ids = (get().byProfile[profileId] ?? []).filter((x) => x !== tagId);
      const byProfile = { ...get().byProfile };
      if (ids.length) byProfile[profileId] = ids; else delete byProfile[profileId];
      assign(byProfile, [profileId]);
    },
    setTags: (profileId, tagIds) => {
      const known = new Set(get().tags.map((t) => t.id));
      const ids = [...new Set(tagIds)].filter((id) => known.has(id));
      const byProfile = { ...get().byProfile };
      if (ids.length) byProfile[profileId] = ids; else delete byProfile[profileId];
      assign(byProfile, [profileId]);
    },
    forgetProfiles: (profileIds) => {
      const byProfile = { ...get().byProfile };
      for (const pid of profileIds) delete byProfile[pid];
      assign(byProfile, profileIds);
    },
    moveProfile: (from, to) => {
      const ids = get().byProfile[from];
      if (!ids) return;
      const byProfile = { ...get().byProfile };
      delete byProfile[from];
      byProfile[to] = [...new Set([...(byProfile[to] ?? []), ...ids])];
      assign(byProfile, [from, to]);
    },
  };
});

// Another space: none of the old tags show while its own are read.
onSpaceMoved(() => {
  if (!loading) return;
  useTags.setState({ tags: [], byProfile: {} });
  void useTags.getState().reload();
});

/** The tags of one profile, in the registry's order. */
export function tagsOf(profileId: string, s: Pick<TagStore, "tags" | "byProfile"> = useTags.getState()): Tag[] {
  const ids = s.byProfile[profileId];
  if (!ids?.length) return [];
  return s.tags.filter((t) => ids.includes(t.id));
}

/** The tags of one profile, kept current. */
export function useProfileTags(profileId: string): Tag[] {
  const tags = useTags((s) => s.tags);
  const ids = useTags((s) => s.byProfile[profileId]);
  if (!ids?.length) return [];
  return tags.filter((t) => ids.includes(t.id));
}

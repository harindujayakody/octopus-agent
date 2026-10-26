import { useEffect, useLayoutEffect, useRef } from "react";
import { create } from "zustand";

/// Unsaved changes, app-wide. Nothing saves itself (manual save, owner
/// 2026-10-07): an editor with changes not yet saved joins this registry
/// while it is dirty, and every exit that would drop them (a page change,
/// opening a project, quitting) asks `confirmLeave()` first. The question is
/// the UnsavedGuard dialog: Save, Don't save, Cancel.

export type UnsavedEditor = {
  id: string;
  /** Names it in the question: "Save changes to {label}?". */
  label: string;
  /** Saves; false when the save failed (the editor shows why and keeps its values). */
  save: () => Promise<boolean>;
  /** Drops the changes. */
  discard: () => void;
};

export type UnsavedChoice = "save" | "discard" | "cancel";

/** The question on screen: which editor, whether its save is running, and
 *  the answer the guard gives back. */
export type UnsavedAsk = { label: string; saving: boolean; answer: (choice: UnsavedChoice) => void };

type UnsavedState = { editors: UnsavedEditor[]; asking: UnsavedAsk | null };

export const unsavedStore = create<UnsavedState>(() => ({ editors: [], asking: null }));

export const hasUnsaved = () => unsavedStore.getState().editors.length > 0;

function register(editor: UnsavedEditor): () => void {
  unsavedStore.setState((s) => ({ editors: [...s.editors, editor] }));
  return () => unsavedStore.setState((s) => ({ editors: s.editors.filter((e) => e !== editor) }));
}

/** Joins the registry while `editor` is non-null; leaves it on null or
 *  unmount. The entry stays the same while the id does (its place in the
 *  newest-first order with it) and always calls the latest props, so an
 *  editor may pass a fresh object every render. */
export function useUnsaved(editor: UnsavedEditor | null): void {
  const latest = useRef(editor);
  useLayoutEffect(() => {
    latest.current = editor;
  });
  const id = editor?.id ?? null;
  useEffect(() => {
    if (id === null) return;
    return register({
      id,
      get label() { return latest.current?.label ?? ""; },
      save: () => latest.current?.save() ?? Promise.resolve(true),
      discard: () => latest.current?.discard(),
    });
  }, [id]);
}

function ask(editor: UnsavedEditor): Promise<UnsavedChoice> {
  return new Promise((resolve) => {
    unsavedStore.setState({ asking: { label: editor.label, saving: false, answer: resolve } });
  });
}

/** The one question in flight: an exit asked for while it shows (a key
 *  behind the dialog) is not taken. */
let pending = false;

/** True when the exit may go on: nothing is unsaved, or every dirty editor,
 *  newest first, was saved or let go. Save that fails, and Cancel (Esc),
 *  stop it: false, with the editor left as it is. */
export async function confirmLeave(): Promise<boolean> {
  if (!hasUnsaved()) return true;
  if (pending) return false;
  pending = true;
  try {
    for (const editor of [...unsavedStore.getState().editors].reverse()) {
      // Gone since the question began (an editor the previous answer closed).
      if (!unsavedStore.getState().editors.includes(editor)) continue;
      const choice = await ask(editor);
      if (choice === "cancel") return false;
      if (choice === "discard") {
        // One that throws must not leave the exit dead: it is logged, and the exit goes on.
        try { editor.discard(); } catch (e) { console.error(`unsaved: discard of ${editor.id} threw`, e); }
        continue;
      }
      unsavedStore.setState((s) => ({ asking: s.asking && { ...s.asking, saving: true } }));
      const saved = await editor.save().catch((e) => { console.error(`unsaved: save of ${editor.id} rejected`, e); return false; });
      if (!saved) return false;
    }
    return true;
  } finally {
    pending = false;
    unsavedStore.setState({ asking: null });
  }
}

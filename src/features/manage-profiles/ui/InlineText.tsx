import { useRef, useState } from "react";
import { IconButton, Input } from "@proxyshard/shardx-ui-kit";
import { CloseIcon, TickIcon } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";
import { unsavedStore, useUnsaved } from "../../../shared/model/unsaved";
import { CellSavePrompt } from "./CellSavePrompt";

/// A one-line field that edits a value in place, saved by a press (manual
/// save, owner 2026-10-07): Enter or the tick beside the field commits, Esc
/// or the cross drops it. Leaving the field with a change asks "Save this
/// change?" under it; leaving it with no change just closes. An unchanged
/// value is a cancel. While it holds a change it is an unsaved editor like any
/// other (`useUnsaved`): a page change or a quit asks "Save changes to
/// {subject}?" first, and nothing saves it behind the person's back.
export function InlineText({ value, label, subject, required = false, onCommit, onCancel }: {
  value: string;
  /** Accessible name; the field has no visible label. */
  label: string;
  /** What the unsaved-changes question calls it: the profile's name. */
  subject: string;
  /** An empty value cancels instead of saving. */
  required?: boolean;
  /** Saves; true when it was saved (the guard's Save reports a failure by it). */
  onCommit: (value: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  const [asking, setAsking] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Enter commits and then the field unmounts; nothing after it may commit or ask again.
  const done = useRef(false);
  // The question was just put away: the press that did it moves the focus on
  // its own, and that blur is not a second "leaving".
  const returning = useRef(false);
  // Selecting everything is for the first focus only: a field the question
  // gave back keeps the caret where it was.
  const fresh = useRef(true);

  const next = draft.trim();
  // Worth saving: not what it was, and not nothing where something is required.
  const changed = next !== value.trim() && !(required && !next);
  // The unsaved-changes question (a page change, a quit) is on screen: it asks for this field.
  const guardUp = unsavedStore((st) => st.asking !== null);
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };
  const commit = async (): Promise<boolean> => {
    if (done.current) return true;
    done.current = true;
    return onCommit(next);
  };
  const finish = (save: boolean) => {
    if (save && changed) void commit();
    else cancel();
  };
  useUnsaved(changed ? { id: "cell-edit", label: subject, save: commit, discard: cancel } : null);
  const keepEditing = () => {
    returning.current = true;
    setAsking(false);
    requestAnimationFrame(() => {
      returning.current = false;
      input.current?.focus({ preventScroll: true });
    });
  };

  return (
    <>
      <div
        ref={field}
        className="flex w-full min-w-0 items-center gap-[4px]"
        // The tick and the cross keep Delete and the arrows: a key on them must not trash or move the row being edited.
        data-own-keys
        // Focus leaving the field and its two buttons for good: a change asks, none just closes.
        onBlur={(e) => {
          if (done.current || asking || returning.current) return;
          if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
          // The guard's question took the keyboard: it is the one asking.
          if (unsavedStore.getState().asking) return;
          if (changed) setAsking(true);
          else finish(false);
        }}
      >
        <Input
          ref={input}
          // FEEL-29: 28 px with a 1 px ring inside the row and no halo, in the
          // row's own type; names and notes are not spellchecked or corrected.
          density="inline"
          technical
          aria-label={label}
          autoFocus
          onFocus={(e) => {
            if (asking) setAsking(false);
            if (fresh.current) { fresh.current = false; e.currentTarget.select(); }
          }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter and Esc also end an input-method composition (Pinyin); those are not ours.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") { e.preventDefault(); finish(true); }
            // Handled here, so the list's Esc (clear the selection) stays out of it.
            if (e.key === "Escape") { e.preventDefault(); finish(false); }
          }}
          // Presses inside the field must not start a row drag or a range select.
          onMouseDown={(e) => e.stopPropagation()}
          wrapperClassName="min-w-0 flex-1"
          // Out by the inline frame's 6 px padding, so the first letter stays
          // where the static text had it (px: the launcher's -ml-1.5 is 5 px).
          className="-ml-[6px] w-[calc(100%+6px)]"
        />
        <div
          className="flex shrink-0 items-center gap-[4px]"
          // A press on a button must not take the keyboard out of the field,
          // or it would count as leaving it (WebKit does not focus a button on a press anyway).
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); finish(false); }
          }}
        >
          {/* 24 px buttons with a 14 px icon. The hit areas are pseudo-elements, 40 px
              tall, reaching outward (the field side, the column gap) and never toward
              each other: they meet in the 4 px between the buttons and do not overlap,
              so a press on the tick's edge cannot run Cancel. */}
          <IconButton
            variant="primary"
            size="3xsmall"
            label={t("cellSave.save")}
            icon={<TickIcon className="size-3.5" />}
            className="before:absolute before:-inset-y-[8px] before:-left-[8px] before:-right-[2px] before:content-['']"
            onClick={() => finish(true)}
          />
          <IconButton
            variant="neutral"
            size="3xsmall"
            label={t("cellSave.cancel")}
            icon={<CloseIcon className="size-3.5" />}
            className="before:absolute before:-inset-y-[8px] before:-left-[2px] before:-right-[10px] before:content-['']"
            onClick={() => finish(false)}
          />
        </div>
      </div>
      <CellSavePrompt
        open={asking && !guardUp}
        anchorRef={field}
        onSave={() => finish(true)}
        onDiscard={() => finish(false)}
        onKeep={keepEditing}
      />
    </>
  );
}

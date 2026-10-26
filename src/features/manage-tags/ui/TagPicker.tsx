import { useEffect, useMemo, useRef, useState } from "react";
import { Combobox, Popover, type ComboboxOption } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { TAG_NAME_MAX, useTags } from "../../../entities/tag";
import { teamRefusal, useRightsChange } from "../../../entities/space";
import { TagChip } from "../../../shared/ui/TagChip";

/// Gives and takes tags for one or many profiles (EMIL-08): type to filter, the
/// first match is highlighted, the arrows move it, Enter toggles the
/// highlighted tag; "Create “x”" is the last row, highlighted only when
/// nothing matches, and Cmd/Ctrl+Enter creates at once (6.2). A tag is
/// checked when every profile has it and mixed when some do; the whole row
/// is the target (FEEL-25). Each tag is the tinted chip a row shows (owner
/// feedback 5t: one look for a tag everywhere). It opens under `anchorRef`,
/// or at `anchorPoint` (a key, a cell) with `triggerRef` the control that
/// toggles it. Each pick applies at once and is quiet; closing it after a net
/// change says "Tags saved" once (manual save, Ruling 2).
export function TagPicker({ open, profileIds, anchorRef, anchorPoint, triggerRef, onClose }: {
  open: boolean;
  profileIds: string[];
  anchorRef?: React.RefObject<HTMLElement | null>;
  anchorPoint?: { x: number; y: number };
  triggerRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const t = useT();
  // A team's tags are made with Create in the team.
  useRightsChange();
  const noCreate = !!teamRefusal("create");
  const tags = useTags((s) => s.tags);
  const byProfile = useTags((s) => s.byProfile);
  const create = useTags((s) => s.create);
  const toggle = useTags((s) => s.toggle);
  const [query, setQuery] = useState("");

  // The tags these profiles had as it opened, to tell on closing whether a
  // pick (or two that cancel) left a change.
  const opened = useRef<string | null>(null);
  const tagsOf = () => {
    const now = useTags.getState().byProfile;
    return profileIds.map((id) => [...(now[id] ?? [])].sort().join(",")).join("|");
  };
  useEffect(() => {
    if (open) { opened.current = tagsOf(); return; }
    if (opened.current !== null && opened.current !== tagsOf()) toast.saved(t("tagPicker.saved"));
    opened.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when it opens or closes
  }, [open]);

  const count = (tagId: string) => profileIds.filter((pid) => byProfile[pid]?.includes(tagId)).length;
  const options = useMemo<ComboboxOption[]>(
    () => tags.map((tag) => ({ value: tag.id, label: tag.name, content: <TagChip tag={tag} /> })),
    [tags],
  );
  const all = tags.filter((tag) => profileIds.length > 0 && count(tag.id) === profileIds.length).map((tag) => tag.id);
  const some = tags.filter((tag) => { const n = count(tag.id); return n > 0 && n < profileIds.length; }).map((tag) => tag.id);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      anchorRef={anchorRef}
      anchorPoint={anchorPoint}
      triggerRef={triggerRef}
      align="start"
      aria-label={t("tagPicker.label")}
      className="w-[260px] p-0"
    >
      <Combobox
        multiple
        aria-label={t("tagPicker.find")}
        placeholder={noCreate ? t("tagPicker.findOnly") : t("tagPicker.find")}
        options={options}
        value={all}
        mixed={some}
        query={query}
        // The name a tag would get, cleaned as the store cleans it, so the
        // comparison with the existing names is the real one (PC-085).
        onQueryChange={(q) => setQuery(q.replace(/\s+/g, " ").slice(0, TAG_NAME_MAX))}
        // A mixed tag goes to every profile; a checked one comes off all.
        onChange={(id) => toggle(profileIds, id)}
        onCreate={noCreate ? undefined : (name) => {
          const tag = create(name);
          if (tag && count(tag.id) < profileIds.length) toggle(profileIds, tag.id);
          setQuery("");
        }}
        createLabel={(name) => t("tagPicker.create", { name })}
        emptyText={tags.length === 0 ? (noCreate ? t("tagPicker.emptyNoCreate") : t("tagPicker.empty")) : undefined}
      />
    </Popover>
  );
}
